// Yetim karantina temizliği ve metadata benzerliği uyarısı (GERÇEK PostgreSQL).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "@ekos/core";
import { loadActorContext } from "../actor.js";
import { startTestDb, type TestDb } from "../testing/pg-harness.js";
import { findOrphanQuarantine } from "./orphans.js";
import { findVisibleMetadataSimilar } from "./duplicates.js";

const NOW = new Date("2026-10-14T06:00:00Z");
const OLD = new Date("2026-10-01T06:00:00Z");
let db: TestDb;
let owner: string;
let typeId: string;
let cpA: string;

async function file(key: string, opts: { scan?: "PENDING" | "INFECTED" | "CLEAN"; prefix?: string; createdAt?: Date }) {
  const id = uuidv7();
  await db.prisma.documentFileObject.create({
    data: {
      id, storageKey: key, storagePrefix: opts.prefix ?? "quarantine", originalFileName: "f.pdf", mimeType: "application/pdf",
      byteSize: BigInt(10), sha256: id.replace(/-/g, "").padEnd(64, "a").slice(0, 64), scanStatus: opts.scan ?? "PENDING",
      createdBy: owner, createdAt: opts.createdAt ?? OLD,
    },
  });
  return id;
}

beforeAll(async () => {
  db = await startTestDb();
  const p = db.prisma;
  owner = (await p.user.create({ data: { email: "orph@t.test", displayName: "O", updatedAt: NOW } })).id;
  const t = await p.documentType.create({ data: { code: "ORPH", name: "Orf", defaultConfidentiality: "INTERNAL", requiredMetadataKeys: [], updatedAt: NOW } as never });
  typeId = t.id;
  await p.metadataDefinition.create({ data: { key: "counterpartyId", label: "Karşı taraf", dataType: "REFERENCE", enumValues: [], updatedAt: NOW } as never });
  cpA = (await p.counterparty.create({ data: { officialName: "A Ltd", countryCode: "TR", status: "ACTIVE", updatedAt: NOW } as never })).id;
});
afterAll(async () => db.stop());

describe("findOrphanQuarantine (silme yok; yalnız rapor)", () => {
  it("yalnız eski, taranmamış, referanssız karantina dosyalarını listeler", async () => {
    const orphan = await file("quarantine/orphan-1", {});
    const fresh = await file("quarantine/fresh-1", { createdAt: new Date() });
    const infected = await file("quarantine/inf-1", { scan: "INFECTED" });
    const rows = await findOrphanQuarantine(db.prisma, new Date("2026-10-10T00:00:00Z"));
    const ids = rows.map((r) => r.fileObjectId);
    expect(ids).toContain(orphan);
    expect(ids).not.toContain(fresh);
    expect(ids).not.toContain(infected);
  });

  it("sürümü olan (referanslı) dosya listede yer almaz", async () => {
    const { createDocument } = await import("./create.js");
    const used = await file("quarantine/used-1", {});
    await db.prisma.documentVersion.create({
      data: { documentId: (await createDocument(db.prisma, { actorId: owner, correlationId: "u", typeCode: "ORPH", title: "Kullanılan", metadata: {} })).documentId, versionNumber: 1, fileObjectId: used, sha256: "a".repeat(64) },
    });
    const rows = await findOrphanQuarantine(db.prisma, new Date("2026-10-10T00:00:00Z"));
    expect(rows.map((r) => r.fileObjectId)).not.toContain(used);
  });

  it("DB tetikleyicisi dosya nesnesi silinmesini reddeder (karar gerekçesi)", async () => {
    const id = await file("quarantine/guard-1", {});
    await expect(db.prisma.documentFileObject.delete({ where: { id } })).rejects.toThrow();
  });
});

describe("findVisibleMetadataSimilar (yalnız uyarı)", () => {
  it("aynı tür+karşı taraf görünür belgeleri döndürür; görünmeyen belge sızmaz", async () => {
    const p = db.prisma;
    const { createDocument } = await import("./create.js");
    const docA = await createDocument(p, { actorId: owner, correlationId: "s1", typeCode: "ORPH", title: "Benzer A", metadata: { counterpartyId: cpA } });
    // Yetkisi olmayan bir aktör: üyeliği yok → hiç sonuç olmamalı.
    const outsider = (await p.user.create({ data: { email: "out@t.test", displayName: "X", updatedAt: NOW } })).id;
    const actorNone = await loadActorContext(p, outsider);
    const hitsNone = await findVisibleMetadataSimilar(p, actorNone, { typeId, counterpartyId: cpA, now: NOW });
    expect(hitsNone).toEqual([]);

    const role = await p.role.create({ data: { code: "R_SIM", name: "Sim", updatedAt: NOW } });
    const perm = await p.permission.upsert({ where: { code: "document.list" }, update: {}, create: { code: "document.list", description: "l" } });
    await p.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } });
    const empty = { departmentIds: [], documentTypeIds: [], counterpartyIds: [], projectIds: [], updatedAt: NOW };
    await p.membership.create({ data: { userId: outsider, roleId: role.id, ...empty } as never });
    const actorAll = await loadActorContext(p, outsider);
    const hits = await findVisibleMetadataSimilar(p, actorAll, { typeId, counterpartyId: cpA, now: NOW });
    expect(hits.map((h) => h.documentId)).toContain(docA.documentId);
  });
});
