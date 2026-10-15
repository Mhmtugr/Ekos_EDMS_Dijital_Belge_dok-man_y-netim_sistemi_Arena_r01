// Faz 2 ikinci dilim entegrasyon testleri (GERÇEK PostgreSQL): OCR işçisi, önizleme, ilişkiler,
// fiziksel arşiv, kayıtlı görünümler. Yetki: görünmeyen → 404, görünür ama izinsiz → 403.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadActorContext } from "../actor.js";
import { startTestDb, type TestDb } from "../testing/pg-harness.js";
import { FakeAv, FakeOcr, MemStorage } from "../testing/fakes.js";
import { createDocument } from "./create.js";
import { registerUpload, scanFile } from "./upload.js";
import { processOneOcrJob, recoverStaleOcrJobs } from "./ocr-worker.js";
import { requestOcrRetry } from "./pipeline.js";
import { getDocumentPreview } from "./preview.js";
import { linkDocuments, listRelations } from "./relations.js";
import { setPhysicalLocation, verifyOriginal } from "./physical-archive.js";
import { createSavedView, deleteSavedView, listSavedViews } from "./saved-views.js";
import { searchDocuments } from "./search.js";

const NOW = new Date("2026-10-13T09:00:00Z");
const MAX = 10 * 1024 * 1024;
const PDF = (tag: string) => new TextEncoder().encode(`%PDF-1.7\n% ${tag}\n${"x".repeat(64)}\n%%EOF`);

let db: TestDb;
let storage: MemStorage;
let av: FakeAv;
let ocr: FakeOcr;
let deps: { prisma: TestDb["prisma"]; storage: MemStorage; av: FakeAv };
let userFull: string; // liste + önizleme + düzenleme + arşiv
let userView: string; // yalnız liste; gizlilik tavanı CONFIDENTIAL
let userNone: string; // üyelik yok

beforeAll(async () => {
  db = await startTestDb();
  const p = db.prisma;
  await p.permission.createMany({
    data: [
      { code: "document.list", description: "l" },
      { code: "document.preview", description: "p" },
      { code: "document.edit_metadata", description: "e" },
      { code: "document.archive", description: "a" },
      { code: "document.view_metadata", description: "v" },
    ],
  });
  const perms = await p.permission.findMany();
  const pid = (c: string) => must(perms.find((x) => x.code === c), c).id;
  const full = await p.role.create({ data: { code: "R_FULL", name: "Tam", updatedAt: NOW } });
  const view = await p.role.create({ data: { code: "R_VIEW", name: "Görüntüleme", updatedAt: NOW } });
  for (const c of ["document.list", "document.preview", "document.edit_metadata", "document.archive"]) {
    await p.rolePermission.create({ data: { roleId: full.id, permissionId: pid(c) } });
  }
  await p.rolePermission.create({ data: { roleId: view.id, permissionId: pid("document.list") } });
  await p.rolePermission.create({ data: { roleId: view.id, permissionId: pid("document.view_metadata") } });
  userFull = (await p.user.create({ data: { email: "full@t.test", displayName: "F", updatedAt: NOW } })).id;
  userView = (await p.user.create({ data: { email: "view@t.test", displayName: "V", updatedAt: NOW } })).id;
  userNone = (await p.user.create({ data: { email: "none@t.test", displayName: "N", updatedAt: NOW } })).id;
  const empty = { departmentIds: [], documentTypeIds: [], counterpartyIds: [], projectIds: [], updatedAt: NOW };
  await p.membership.create({ data: { userId: userFull, roleId: full.id, ...empty } as never });
  await p.membership.create({ data: { userId: userView, roleId: view.id, ...empty, maxConfidentiality: "CONFIDENTIAL" } as never });
  await p.documentType.create({ data: { code: "SOZLESME", name: "Sözleşme", defaultConfidentiality: "CONFIDENTIAL", requiredMetadataKeys: [], updatedAt: NOW } as never });
  await p.documentType.create({ data: { code: "TARAMA", name: "Tarama", defaultConfidentiality: "INTERNAL", requiredMetadataKeys: [], ocrRequired: true, updatedAt: NOW } as never });
  await p.documentType.create({ data: { code: "IK_BELGE", name: "İK", defaultConfidentiality: "HIGHLY_RESTRICTED", requiredMetadataKeys: [], updatedAt: NOW } as never });
});

beforeEach(() => {
  storage = new MemStorage();
  av = new FakeAv();
  ocr = new FakeOcr();
  deps = { prisma: db.prisma, storage, av };
});

afterAll(async () => {
  await db.stop();
});

const actor = (id: string) => loadActorContext(db.prisma, id);

function must<T>(v: T | undefined | null, what: string): T {
  if (v === undefined || v === null) throw new Error(`beklenen kayıt yok: ${what}`);
  return v;
}

/** Yükle + (isteğe bağlı) tara + belge oluştur. */
async function makeDoc(opts: { type: string; title: string; tag: string; scan: boolean; confidentiality?: "INTERNAL" | "CONFIDENTIAL" | "HIGHLY_RESTRICTED" }) {
  const up = await registerUpload(deps, { actorId: userFull, correlationId: `up-${opts.tag}`, filename: `${opts.tag}.pdf`, declaredMime: "application/pdf", bytes: PDF(opts.tag), maxBytes: MAX });
  if (up.status !== "QUARANTINED") throw new Error("upload");
  const created = await createDocument(db.prisma, {
    actorId: userFull, correlationId: `cr-${opts.tag}`, typeCode: opts.type, title: opts.title, metadata: {}, fileObjectId: up.fileObjectId,
    ...(opts.confidentiality ? { confidentiality: opts.confidentiality } : {}),
  });
  if (opts.scan) await scanFile(deps, { fileObjectId: up.fileObjectId, actorId: null, correlationId: `sc-${opts.tag}` });
  return { documentId: created.documentId, fileObjectId: up.fileObjectId };
}

describe("OCR işçisi (madde 4)", () => {
  it("başarılı OCR: iş DONE, güven kaydedilir, metin aranabilir olur", async () => {
    const d = await makeDoc({ type: "TARAMA", title: "Taranmış Form", tag: "ocr-ok", scan: true });
    const job = await db.prisma.oCRJob.findFirstOrThrow({ where: { fileObjectId: d.fileObjectId } });
    expect(job.status).toBe("QUEUED");
    const r = await processOneOcrJob({ prisma: db.prisma, storage, ocr });
    expect(r?.result).toBe("DONE");
    const after = await db.prisma.oCRJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(after.status).toBe("DONE");
    expect(Number(after.confidence)).toBeCloseTo(0.9);
    expect(after.resultStorageKey).toMatch(/^objects\/ocr-/);
    const hits = await searchDocuments(db.prisma, { actor: await actor(userFull), now: NOW, query: "metni" });
    expect(hits.items.some((h) => h.id === d.documentId)).toBe(true);
  });

  it("geçici hata: FAILED_RETRYABLE, uydurma metin yok; yeniden deneme kuyruğa alır", async () => {
    const d = await makeDoc({ type: "TARAMA", title: "Bozuk Tarama", tag: "ocr-retry", scan: true });
    ocr.next = { status: "FAILED", retryable: true, code: "TIMEOUT" };
    await processOneOcrJob({ prisma: db.prisma, storage, ocr });
    const job = await db.prisma.oCRJob.findFirstOrThrow({ where: { fileObjectId: d.fileObjectId } });
    expect(job.status).toBe("FAILED_RETRYABLE");
    expect(job.confidence).toBeNull();
    expect(job.resultStorageKey).toBeNull();
    const doc = await db.prisma.document.findUniqueOrThrow({ where: { id: d.documentId } });
    expect(doc.ingestStatus).toBe("FAILED_RETRYABLE");
    expect(doc.searchText).not.toContain("sözleşme");
    ocr.next = { status: "OK", languages: "tur+eng", pages: [{ page: 1, text: "Yeni metin", confidence: 0.8 }] };
    await requestOcrRetry(db.prisma, d.fileObjectId);
    expect((await processOneOcrJob({ prisma: db.prisma, storage, ocr }))?.result).toBe("DONE");
  });

  it("kalıcı hata: FAILED_FINAL; yeniden deneme reddedilir", async () => {
    const d = await makeDoc({ type: "TARAMA", title: "Desteklenmeyen", tag: "ocr-final", scan: true });
    ocr.next = { status: "FAILED", retryable: false, code: "UNSUPPORTED_MIME" };
    expect((await processOneOcrJob({ prisma: db.prisma, storage, ocr }))?.result).toBe("FAILED_FINAL");
    await expect(requestOcrRetry(db.prisma, d.fileObjectId)).rejects.toMatchObject({ code: "OCR_NOT_RETRYABLE" });
  });

  it("bayat PROCESSING işi (işçi çökmesi) kurtarılır", async () => {
    const d = await makeDoc({ type: "TARAMA", title: "Çöken İşçi", tag: "ocr-stale", scan: true });
    const job = await db.prisma.oCRJob.findFirstOrThrow({ where: { fileObjectId: d.fileObjectId } });
    await db.prisma.$executeRaw`UPDATE "OCRJob" SET "status"='PROCESSING', "attempts"=1, "updatedAt"= now() - interval '1 hour' WHERE "id"=${job.id}::uuid`;
    const n = await recoverStaleOcrJobs(db.prisma, new Date(Date.now() - 15 * 60_000));
    expect(n).toBeGreaterThanOrEqual(1);
    const after = await db.prisma.oCRJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(after.status).toBe("FAILED_RETRYABLE");
    expect(after.lastErrorCode).toBe("WORKER_LOST");
  });
});

describe("önizleme (madde 5)", () => {
  it("yetkili kullanıcı temiz dosyayı alır; denetime yazılır", async () => {
    const d = await makeDoc({ type: "SOZLESME", title: "Önizleme Sözleşmesi", tag: "pv-ok", scan: true });
    const r = await getDocumentPreview({ prisma: db.prisma, storage }, { actor: await actor(userFull), now: NOW, documentId: d.documentId, correlationId: "pv1" });
    expect(r.mimeType).toBe("application/pdf");
    expect(new TextDecoder().decode(r.bytes)).toContain("pv-ok");
    expect(await db.prisma.auditEvent.count({ where: { eventType: "DOCUMENT_PREVIEWED", correlationId: "pv1" } })).toBe(1);
  });

  it("görünür ama önizleme izni yok → FORBIDDEN (403)", async () => {
    const d = await makeDoc({ type: "SOZLESME", title: "İzinsiz Önizleme", tag: "pv-forbid", scan: true });
    await expect(getDocumentPreview({ prisma: db.prisma, storage }, { actor: await actor(userView), now: NOW, documentId: d.documentId, correlationId: "pv2" })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("görünmeyen belge → NOT_FOUND (varlık sızmaz)", async () => {
    const d = await makeDoc({ type: "IK_BELGE", title: "Özlük Dosyası", tag: "pv-hidden", scan: true });
    await expect(getDocumentPreview({ prisma: db.prisma, storage }, { actor: await actor(userView), now: NOW, documentId: d.documentId, correlationId: "pv3" })).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await expect(getDocumentPreview({ prisma: db.prisma, storage }, { actor: await actor(userNone), now: NOW, documentId: d.documentId, correlationId: "pv4" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("karantinadaki dosya asla önizlenmez", async () => {
    const d = await makeDoc({ type: "SOZLESME", title: "Karantina", tag: "pv-q", scan: false });
    await expect(getDocumentPreview({ prisma: db.prisma, storage }, { actor: await actor(userFull), now: NOW, documentId: d.documentId, correlationId: "pv5" })).rejects.toMatchObject({ code: "FILE_NOT_CLEAN" });
  });
});

describe("ilişkiler (madde 11)", () => {
  it("ilişki kurulur; görünmeyen karşı taraf listede gizlenir", async () => {
    const a = await makeDoc({ type: "SOZLESME", title: "Ana Sözleşme", tag: "rel-a", scan: true });
    const b = await makeDoc({ type: "SOZLESME", title: "Ek Belge", tag: "rel-b", scan: true });
    const c = await makeDoc({ type: "IK_BELGE", title: "Gizli Ek", tag: "rel-c", scan: true });
    await linkDocuments(db.prisma, { actor: await actor(userFull), now: NOW, correlationId: "rl1", fromId: a.documentId, toId: b.documentId, relationType: "ATTACHMENT" });
    await linkDocuments(db.prisma, { actor: await actor(userFull), now: NOW, correlationId: "rl2", fromId: a.documentId, toId: c.documentId, relationType: "ATTACHMENT" });
    const forView = await listRelations(db.prisma, { actor: await actor(userView), now: NOW, documentId: a.documentId });
    expect(forView.map((r) => r.document.id)).toEqual([b.documentId]);
    const forFull = await listRelations(db.prisma, { actor: await actor(userFull), now: NOW, documentId: a.documentId });
    expect(forFull).toHaveLength(2);
  });

  it("kendine ilişki, tekrar ve yetkisiz düzenleme reddedilir", async () => {
    const a = await makeDoc({ type: "SOZLESME", title: "Tek Belge", tag: "rel-d", scan: true });
    const b = await makeDoc({ type: "SOZLESME", title: "İkinci Belge", tag: "rel-e", scan: true });
    await expect(linkDocuments(db.prisma, { actor: await actor(userFull), now: NOW, correlationId: "rl3", fromId: a.documentId, toId: a.documentId, relationType: "ATTACHMENT" })).rejects.toMatchObject({ code: "RELATION_INVALID" });
    await expect(linkDocuments(db.prisma, { actor: await actor(userView), now: NOW, correlationId: "rl4", fromId: a.documentId, toId: b.documentId, relationType: "REVISION" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await linkDocuments(db.prisma, { actor: await actor(userFull), now: NOW, correlationId: "rl5", fromId: a.documentId, toId: b.documentId, relationType: "REVISION" });
    await expect(linkDocuments(db.prisma, { actor: await actor(userFull), now: NOW, correlationId: "rl6", fromId: a.documentId, toId: b.documentId, relationType: "REVISION" })).rejects.toMatchObject({ code: "RELATION_INVALID" });
  });
});

describe("fiziksel arşiv (madde 11)", () => {
  it("konum kaydı, asıl doğrulama ve konum değişince sıfırlanma", async () => {
    const d = await makeDoc({ type: "SOZLESME", title: "Kağıt Asıl", tag: "phy-1", scan: true });
    const a = await actor(userFull);
    await expect(setPhysicalLocation(db.prisma, { actor: await actor(userView), now: NOW, correlationId: "ph0", documentId: d.documentId, expectedRowVersion: 0, location: { box: "K-1" } })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const first = await setPhysicalLocation(db.prisma, { actor: a, now: NOW, correlationId: "ph1", documentId: d.documentId, expectedRowVersion: 0, location: { box: "K-1", file: "F-7", shelf: "R2" } });
    expect(first.rowVersion).toBe(1);
    await verifyOriginal(db.prisma, { actor: a, now: NOW, correlationId: "ph2", documentId: d.documentId, expectedRowVersion: 1 });
    let loc = await db.prisma.physicalArchiveLocation.findUniqueOrThrow({ where: { documentId: d.documentId } });
    expect(loc.originalVerified).toBe(true);
    await expect(setPhysicalLocation(db.prisma, { actor: a, now: NOW, correlationId: "ph3", documentId: d.documentId, expectedRowVersion: 1, location: { box: "K-1" } })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await setPhysicalLocation(db.prisma, { actor: a, now: NOW, correlationId: "ph4", documentId: d.documentId, expectedRowVersion: 2, location: { box: "K-9", file: "F-7", shelf: "R2" } });
    loc = await db.prisma.physicalArchiveLocation.findUniqueOrThrow({ where: { documentId: d.documentId } });
    expect(loc.originalVerified).toBe(false);
  });
});

describe("kayıtlı görünümler (madde 8)", () => {
  it("yalnız sahibi görür ve siler; ad tekil", async () => {
    const a = await actor(userFull);
    await createSavedView(db.prisma, { ownerId: a.userId, name: "Sözleşmeler", criteria: { query: "sözleşme" } });
    await expect(createSavedView(db.prisma, { ownerId: a.userId, name: "Sözleşmeler", criteria: { query: "x" } })).rejects.toMatchObject({ code: "SAVED_VIEW_DUPLICATE" });
    expect((await listSavedViews(db.prisma, userView)).length).toBe(0);
    const mine = await listSavedViews(db.prisma, userFull);
    expect(mine.map((v) => v.name)).toContain("Sözleşmeler");
    const id = must(mine[0], "görünüm").id;
    await expect(deleteSavedView(db.prisma, { ownerId: userView, viewId: id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await deleteSavedView(db.prisma, { ownerId: userFull, viewId: id });
    expect((await listSavedViews(db.prisma, userFull)).length).toBe(0);
  });
});
