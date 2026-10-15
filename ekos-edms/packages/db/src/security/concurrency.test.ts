// Faz 7 madde 1: eşzamanlı çelişkili işlemler (GERÇEK PostgreSQL). Aynı satır sürümüyle iki yazım aynı anda gelirse
// yalnız biri kabul edilmelidir (kayıp güncelleme yok).
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { uuidv7 } from "@ekos/core";
import { startTestDb, type TestDb } from "../testing/pg-harness.js";
import { createContract } from "../contracts/lifecycle.js";
import { createNewVersion } from "../documents/create.js";

const NOW = new Date("2026-10-14T06:00:00Z");
let db: TestDb;
let actor: string;
let cpId: string;

async function cleanFile(tag: string): Promise<string> {
  const id = uuidv7();
  await db.prisma.documentFileObject.create({
    data: {
      id,
      storageKey: `objects/${tag}-${id}`,
      storagePrefix: "objects",
      originalFileName: `${tag}.pdf`,
      mimeType: "application/pdf",
      byteSize: BigInt(10),
      sha256: id.replace(/-/g, "").padEnd(64, "0").slice(0, 64),
      scanStatus: "CLEAN",
      createdBy: actor,
    },
  });
  return id;
}

beforeAll(async () => {
  db = await startTestDb();
  const p = db.prisma;
  await p.documentType.create({
    data: { code: "SOZLESME", name: "Sözleşme", defaultConfidentiality: "CONFIDENTIAL", requiredMetadataKeys: ["counterpartyId"], updatedAt: NOW } as never,
  });
  await p.metadataDefinition.create({ data: { key: "counterpartyId", label: "Karşı taraf", dataType: "REFERENCE", enumValues: [], updatedAt: NOW } as never });
  await p.legalEntity.create({ data: { name: "EKOS Test A.Ş.", countryCode: "TR", updatedAt: NOW } as never });
  cpId = (await p.counterparty.create({ data: { officialName: "Eşzamanlılık Ltd.", countryCode: "TR", status: "ACTIVE", updatedAt: NOW } as never })).id;
  actor = (await p.user.create({ data: { email: "race@t.test", displayName: "Yarış", updatedAt: NOW } })).id;
});

afterAll(async () => {
  await db.stop();
});

describe("eşzamanlı çelişkili işlemler", () => {
  it("aynı satır sürümüyle iki yeni sürüm aynı anda gelirse yalnız biri kabul edilir", async () => {
    const c = await createContract(db.prisma, {
      actorId: actor, correlationId: "race-0", typeCode: "SOZLESME", title: "Yarış sözleşmesi", counterpartyId: cpId,
      fileObjectId: await cleanFile("base"), now: NOW,
    });
    const before = await db.prisma.document.findUniqueOrThrow({ where: { id: c.documentId } });
    const [f1, f2] = [await cleanFile("a"), await cleanFile("b")];
    const attempt = (fileObjectId: string, cid: string) =>
      createNewVersion(db.prisma, { actorId: actor, correlationId: cid, documentId: c.documentId, expectedRowVersion: before.rowVersion, fileObjectId, reason: "eşzamanlı düzenleme" });
    const results = await Promise.allSettled([attempt(f1, "race-1"), attempt(f2, "race-2")]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect(rejected[0]?.reason).toMatchObject({ code: "VERSION_CONFLICT" });
    // Kayıp güncelleme yok: sürüm numarası yalnız bir kez artar, belge rowVersion tek artış görür.
    const versions = await db.prisma.documentVersion.count({ where: { documentId: c.documentId } });
    expect(versions).toBe(2);
    const after = await db.prisma.document.findUniqueOrThrow({ where: { id: c.documentId } });
    expect(after.rowVersion).toBe(before.rowVersion + 1);
  });
});
