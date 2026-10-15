// Faz 2 servis entegrasyon testleri: GERÇEK PostgreSQL (embedded), migration zinciri uygulanmış.
/* Test sahteleri (bellek deposu, sahte AV) senkron/asenkron ayrımı gerektirmez. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadActorContext } from "../actor.js";
import { startTestDb, type TestDb } from "../testing/pg-harness.js";
import { FakeAv, MemStorage } from "../testing/fakes.js";
import { createDocument, createNewVersion } from "./create.js";
import { registerUpload, scanFile, sha256OfBytes } from "./upload.js";
import { findVisibleDuplicates, searchDocuments } from "./search.js";
import { registerManifest, resumeManifestImport, startManifestImport } from "./import.js";

const PDF = (tag: string) => new TextEncoder().encode(`%PDF-1.7\n% ${tag}\n${"x".repeat(64)}\n%%EOF`);
const NOW = new Date("2026-10-13T09:00:00Z");
const MAX = 10 * 1024 * 1024;

let db: TestDb;
let storage: MemStorage;
let av: FakeAv;
let deps: { prisma: TestDb["prisma"]; storage: MemStorage; av: FakeAv };
let userA: string; // yetkili (document.list)
let userB: string; // üyeliksiz (yetkisiz)

beforeAll(async () => {
  db = await startTestDb();
  const p = db.prisma;
  await p.permission.createMany({
    data: [{ code: "document.list", description: "Belge listele" }],
  });
  const perm = await p.permission.findUniqueOrThrow({ where: { code: "document.list" } });
  const role = await p.role.create({ data: { code: "R_LIST", name: "Liste", updatedAt: NOW } });
  await p.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } });
  userA = (await p.user.create({ data: { email: "a@t.test", displayName: "A", updatedAt: NOW } })).id;
  userB = (await p.user.create({ data: { email: "b@t.test", displayName: "B", updatedAt: NOW } })).id;
  await p.membership.create({ data: { userId: userA, roleId: role.id, departmentIds: [], documentTypeIds: [], counterpartyIds: [], projectIds: [], updatedAt: NOW } as never });
  await p.documentType.create({ data: { code: "SOZLESME", name: "Sözleşme", defaultConfidentiality: "CONFIDENTIAL", requiredMetadataKeys: ["documentDate"], updatedAt: NOW } as never });
  await p.documentType.create({ data: { code: "IK_BELGE", name: "İK Belgesi", defaultConfidentiality: "HIGHLY_RESTRICTED", requiredMetadataKeys: [], updatedAt: NOW } as never });
  await p.metadataDefinition.create({ data: { key: "documentDate", label: "Belge tarihi", dataType: "DATE", updatedAt: NOW } as never });
});

beforeEach(() => {
  storage = new MemStorage();
  av = new FakeAv();
  deps = { prisma: db.prisma, storage, av };
});

afterAll(async () => {
  await db.stop();
});

async function actorA() {
  return loadActorContext(db.prisma, userA);
}

describe("yükleme ve tarama (A4)", () => {
  it("MZ (çalıştırılabilir) içerik reddedilir ve denetime yazılır", async () => {
    const r = await registerUpload(deps, {
      actorId: userA, correlationId: "c1", filename: "x.pdf", declaredMime: "application/pdf",
      bytes: new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2]), maxBytes: MAX,
    });
    expect(r.status).toBe("REJECTED");
    const audit = await db.prisma.auditEvent.findFirst({ where: { eventType: "FILE_UPLOAD_REJECTED", correlationId: "c1" } });
    expect(audit?.outcome).toBe("DENIED");
    expect(storage.map.size).toBe(0);
  });

  it("geçerli PDF karantinaya yazılır; tarama CLEAN olunca objects/ alanına çıkar", async () => {
    const bytes = PDF("temiz");
    const up = await registerUpload(deps, { actorId: userA, correlationId: "c2", filename: "temiz.pdf", declaredMime: "application/pdf", bytes, maxBytes: MAX });
    if (up.status !== "QUARANTINED") throw new Error("beklenmedik");
    const f = await db.prisma.documentFileObject.findUniqueOrThrow({ where: { id: up.fileObjectId } });
    expect(f.storageKey.startsWith("quarantine/")).toBe(true);
    expect(f.sha256).toBe(sha256OfBytes(bytes));
    const res = await scanFile(deps, { fileObjectId: up.fileObjectId, actorId: userA, correlationId: "c3" });
    expect(res.status).toBe("CLEAN");
    const after = await db.prisma.documentFileObject.findUniqueOrThrow({ where: { id: up.fileObjectId } });
    expect(after.storageKey.startsWith("objects/")).toBe(true);
    expect(after.scanStatus).toBe("CLEAN");
    expect(storage.map.has(f.storageKey)).toBe(false);
  });

  it("virüs bulunursa INFECTED; dosya asla objects/'e çıkmaz", async () => {
    const up = await registerUpload(deps, { actorId: userA, correlationId: "c4", filename: "virus.pdf", declaredMime: "application/pdf", bytes: PDF("virus"), maxBytes: MAX });
    if (up.status !== "QUARANTINED") throw new Error("beklenmedik");
    av.next = { status: "INFECTED", signature: "Eicar-Test" };
    const res = await scanFile(deps, { fileObjectId: up.fileObjectId, actorId: null, correlationId: "c5" });
    expect(res).toEqual({ status: "INFECTED", signature: "Eicar-Test" });
    const f = await db.prisma.documentFileObject.findUniqueOrThrow({ where: { id: up.fileObjectId } });
    expect(f.scanStatus).toBe("INFECTED");
    expect(f.storageKey.startsWith("quarantine/")).toBe(true);
  });

  it("tarayıcı kapalıyken UNAVAILABLE kalıcı karar değildir; dosya karantinada kalır, yeniden taranabilir", async () => {
    const up = await registerUpload(deps, { actorId: userA, correlationId: "c6", filename: "bekle.pdf", declaredMime: "application/pdf", bytes: PDF("bekle"), maxBytes: MAX });
    if (up.status !== "QUARANTINED") throw new Error("beklenmedik");
    av.next = { status: "UNAVAILABLE", reason: "clamd kapalı" };
    expect((await scanFile(deps, { fileObjectId: up.fileObjectId, actorId: null, correlationId: "c7" })).status).toBe("UNAVAILABLE");
    av.next = { status: "CLEAN" };
    expect((await scanFile(deps, { fileObjectId: up.fileObjectId, actorId: null, correlationId: "c8" })).status).toBe("CLEAN");
  });

  it("depodaki bayt hash'i kayıtla uyuşmazsa tarama yapılmaz (bütünlük)", async () => {
    const up = await registerUpload(deps, { actorId: userA, correlationId: "c9", filename: "boz.pdf", declaredMime: "application/pdf", bytes: PDF("boz"), maxBytes: MAX });
    if (up.status !== "QUARANTINED") throw new Error("beklenmedik");
    const f = await db.prisma.documentFileObject.findUniqueOrThrow({ where: { id: up.fileObjectId } });
    storage.map.set(f.storageKey, PDF("tahrif"));
    await expect(scanFile(deps, { fileObjectId: up.fileObjectId, actorId: null, correlationId: "c10" })).rejects.toMatchObject({ code: "INTEGRITY_MISMATCH" });
  });
});

describe("belge oluşturma ve sürümleme (A4, madde 3)", () => {
  it("zorunlu metadata eksikse oluşturulmaz", async () => {
    await expect(createDocument(db.prisma, { actorId: userA, correlationId: "d1", typeCode: "SOZLESME", title: "Tedarik", metadata: {} })).rejects.toMatchObject({ code: "REQUIRED_METADATA_MISSING" });
  });

  it("İK belgesi gizliliği asgarinin altına düşürülemez", async () => {
    await expect(createDocument(db.prisma, { actorId: userA, correlationId: "d2", typeCode: "IK_BELGE", title: "Özlük", metadata: {}, confidentiality: "INTERNAL" })).rejects.toMatchObject({ code: "METADATA_INVALID" });
  });

  it("dosyalı belge: ilk sürüm bağlanır, tarama sonrası belge hattı ilerler", async () => {
    const up = await registerUpload(deps, { actorId: userA, correlationId: "d3", filename: "ilk.pdf", declaredMime: "application/pdf", bytes: PDF("ilk"), maxBytes: MAX });
    if (up.status !== "QUARANTINED") throw new Error("beklenmedik");
    const created = await createDocument(db.prisma, { actorId: userA, correlationId: "d4", typeCode: "SOZLESME", title: "İstanbul Tedarik Sözleşmesi", metadata: { documentDate: "2026-03-01" }, fileObjectId: up.fileObjectId });
    expect(created.number).toMatch(/^EKOS-/);
    const doc = await db.prisma.document.findUniqueOrThrow({ where: { id: created.documentId } });
    expect(doc.currentVersionId).not.toBeNull();
    expect(doc.ingestStatus).toBe("QUARANTINED");
    await scanFile(deps, { fileObjectId: up.fileObjectId, actorId: null, correlationId: "d5" });
    const after = await db.prisma.document.findUniqueOrThrow({ where: { id: created.documentId } });
    expect(after.ingestStatus).not.toBe("QUARANTINED");
    expect(after.ingestStatus).not.toBe("REJECTED");
  });

  it("yeni sürüm: önceki sürüm salt-okunur kalır, sürüm no artar, eşzamanlılık 409", async () => {
    const up1 = await registerUpload(deps, { actorId: userA, correlationId: "e1", filename: "v1.pdf", declaredMime: "application/pdf", bytes: PDF("v1"), maxBytes: MAX });
    if (up1.status !== "QUARANTINED") throw new Error("beklenmedik");
    const created = await createDocument(db.prisma, { actorId: userA, correlationId: "e2", typeCode: "SOZLESME", title: "Sürüm testi", metadata: { documentDate: "2026-04-01" }, fileObjectId: up1.fileObjectId });
    const up2 = await registerUpload(deps, { actorId: userA, correlationId: "e3", filename: "v2.pdf", declaredMime: "application/pdf", bytes: PDF("v2"), maxBytes: MAX });
    if (up2.status !== "QUARANTINED") throw new Error("beklenmedik");
    const doc = await db.prisma.document.findUniqueOrThrow({ where: { id: created.documentId } });
    await expect(createNewVersion(db.prisma, { actorId: userA, correlationId: "e4", documentId: created.documentId, expectedRowVersion: doc.rowVersion + 5, fileObjectId: up2.fileObjectId, reason: "Güncelleme" })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    const r = await createNewVersion(db.prisma, { actorId: userA, correlationId: "e5", documentId: created.documentId, expectedRowVersion: doc.rowVersion, fileObjectId: up2.fileObjectId, reason: "Güncelleme" });
    expect(r.versionNumber).toBe(2);
    const v1 = await db.prisma.documentVersion.findFirstOrThrow({ where: { documentId: created.documentId, versionNumber: 1 } });
    expect(v1.isReadOnly).toBe(true);
    expect(v1.fileObjectId).not.toBeNull(); // eski sürümün dosyası korunur
    // DB koruması: salt-okunur sürüm değiştirilemez
    await expect(db.prisma.documentVersion.update({ where: { id: v1.id }, data: { changeReason: "değiştir" } })).rejects.toThrow();
  });
});

describe("arama ve görünürlük (A4, madde 6-7)", () => {
  it("Türkçe normalize arama yetkili kullanıcıya sonuç verir, yetkisize vermez", async () => {
    const up = await registerUpload(deps, { actorId: userA, correlationId: "s1", filename: "ara.pdf", declaredMime: "application/pdf", bytes: PDF("ara"), maxBytes: MAX });
    if (up.status !== "QUARANTINED") throw new Error("beklenmedik");
    await createDocument(db.prisma, { actorId: userA, correlationId: "s2", typeCode: "SOZLESME", title: "Ankara Hizmet Anlaşması", metadata: { documentDate: "2026-05-01" }, fileObjectId: up.fileObjectId });
    const a = await searchDocuments(db.prisma, { actor: await actorA(), now: NOW, query: "ANKARA" });
    expect(a.items.some((i) => i.title === "Ankara Hizmet Anlaşması")).toBe(true);
    const b = await searchDocuments(db.prisma, { actor: await loadActorContext(db.prisma, userB), now: NOW, query: "ankara" });
    expect(b.items).toHaveLength(0);
  });

  it("sayfalama imleci tutarlı çalışır", async () => {
    const page1 = await searchDocuments(db.prisma, { actor: await actorA(), now: NOW, query: "sözleşme", limit: 1 });
    expect(page1.items).toHaveLength(1);
    if (page1.nextCursor) {
      const page2 = await searchDocuments(db.prisma, { actor: await actorA(), now: NOW, query: "sözleşme", limit: 1, cursor: page1.nextCursor });
      expect(page2.items[0]?.id).not.toBe(page1.items[0]?.id);
    }
  });

  it("kopya tespiti: aynı SHA-256 yalnızca görülebilen belgelerde döner", async () => {
    const bytes = PDF("kopya");
    const u1 = await registerUpload(deps, { actorId: userA, correlationId: "k1", filename: "k1.pdf", declaredMime: "application/pdf", bytes, maxBytes: MAX });
    const u2 = await registerUpload(deps, { actorId: userA, correlationId: "k2", filename: "k2.pdf", declaredMime: "application/pdf", bytes, maxBytes: MAX });
    if (u1.status !== "QUARANTINED" || u2.status !== "QUARANTINED") throw new Error("beklenmedik");
    const c = await createDocument(db.prisma, { actorId: userA, correlationId: "k3", typeCode: "SOZLESME", title: "Kopya A", metadata: { documentDate: "2026-06-01" }, fileObjectId: u1.fileObjectId });
    const ids = await findVisibleDuplicates(db.prisma, await actorA(), NOW, sha256OfBytes(bytes));
    expect(ids).toContain(c.documentId);
    expect(await findVisibleDuplicates(db.prisma, await loadActorContext(db.prisma, userB), NOW, sha256OfBytes(bytes))).toEqual([]);
  });
});

describe("toplu içe aktarım (madde 9)", () => {
  it("satır bazlı sonuç: geçerli satır OK, hatalı satırlar ERROR ile raporlanır", async () => {
    const f1 = await registerUpload(deps, { actorId: userA, correlationId: "i1", filename: "imp-1.pdf", declaredMime: "application/pdf", bytes: PDF("imp1"), maxBytes: MAX });
    if (f1.status !== "QUARANTINED") throw new Error("beklenmedik");
    const csv = [
      "fileName,documentTypeCode,title,documentDate",
      "imp-1.pdf,SOZLESME,İçe Aktarılan Sözleşme,2026-02-02",
      "yok.pdf,SOZLESME,Dosyası Yok,2026-02-03",
      "imp-1.pdf,SOZLESME,Tarih Bozuk,2026-13-40",
      "",
    ].join("\n");
    const bytes = new TextEncoder().encode(csv);
    const m = await registerManifest(deps, { actorId: userA, correlationId: "i2", filename: "manifest.csv", bytes });
    expect(m.scanStatus).toBe("CLEAN");
    const rep = await startManifestImport(deps, { actorId: userA, correlationId: "i3", fileObjectId: m.fileObjectId });
    expect(rep.status).toBe("COMPLETED_WITH_ERRORS");
    expect(rep.okRows + rep.errorRows).toBe(rep.totalRows);
    expect(rep.okRows).toBe(1);
    expect(rep.errors.length).toBe(rep.errorRows);
    expect(rep.errors.find((e) => e.line === 3)?.code).toBe("FILE_NOT_FOUND");
    expect(rep.errors.find((e) => e.line === 3)?.rowNumber).toBe(2);
    expect(rep.errors.find((e) => e.line === 4)?.code).toBe("DATE_INVALID");
    expect(rep.errors.find((e) => e.line === 4)?.rowNumber).toBe(3);
    const again = await resumeManifestImport(deps, { actorId: userA, correlationId: "i4", batchId: rep.batchId });
    expect(again.okRows).toBe(rep.okRows);
    const rows = await db.prisma.importRowResult.count({ where: { batchId: rep.batchId } });
    expect(rows).toBe(rep.totalRows);
    const created = await db.prisma.document.findMany({ where: { title: "İçe Aktarılan Sözleşme" } });
    expect(created).toHaveLength(1);
  });

  it("başlık hatası (zorunlu sütun yok) satıra bağlanamaz → batch FAILED", async () => {
    const bytes = new TextEncoder().encode("fileName,title\nx.pdf,Y\n");
    const m = await registerManifest(deps, { actorId: userA, correlationId: "i5", filename: "bozuk.csv", bytes });
    const rep = await startManifestImport(deps, { actorId: userA, correlationId: "i6", fileObjectId: m.fileObjectId });
    expect(rep.status).toBe("FAILED");
  });

  it("CSV dışı uzantı ve ikili içerik reddedilir", async () => {
    await expect(registerManifest(deps, { actorId: userA, correlationId: "i7", filename: "x.xlsx", bytes: new TextEncoder().encode("a,b") })).rejects.toMatchObject({ code: "FILE_REJECTED" });
    await expect(registerManifest(deps, { actorId: userA, correlationId: "i8", filename: "x.csv", bytes: new Uint8Array([0x61, 0, 0x62]) })).rejects.toMatchObject({ code: "FILE_REJECTED" });
  });
});

