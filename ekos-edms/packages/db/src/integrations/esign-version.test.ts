// Faz 7 açık boşluk 1: e-imza tamamlanma → imzalı sözleşme sürümü (GERÇEK PostgreSQL).
// Kurulum notu: onay akışının tamamı lifecycle.test.ts'te kapsanır; burada imza aşamasındaki sözleşme, tamamlanmış bir
// onay iş akışı kaydıyla doğrudan kurulur (ACTIVE geçişinin önkoşulu: allApprovalsCompleted).
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7, type ContractLifecycleStatus } from "@ekos/core";
import { FakeAv, MemStorage } from "../testing/fakes.js";
import { startTestDb, type TestDb } from "../testing/pg-harness.js";
import { createContract, recordSignatureAndActivate } from "../contracts/lifecycle.js";
import { createNewVersion } from "../documents/create.js";
import { scanFile } from "../documents/upload.js";
import { DomainError } from "../documents/shared.js";
import { linkExternalRecord, recordSignedVersion } from "./esign.js";

const NOW = new Date("2026-10-14T06:00:00Z");
const TYPE = "SOZLESME";

let db: TestDb;
let initiator: string;
let cpId: string;
let defVersionId: string;

function sha(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function cleanFile(tag: string): Promise<string> {
  const id = uuidv7();
  const key = `objects/${tag}-${id}`;
  await db.prisma.documentFileObject.create({
    data: {
      id,
      storageKey: key,
      storagePrefix: "objects",
      originalFileName: `${tag}.pdf`,
      mimeType: "application/pdf",
      byteSize: BigInt(10),
      sha256: sha(new TextEncoder().encode(tag + id)),
      scanStatus: "CLEAN",
      createdBy: initiator,
    },
  });
  return id;
}

/** İmza aşamasında bir sözleşme kurar. status: READY_FOR_SIGNATURE | PENDING_SIGNATURE | DRAFT. */
async function signableContract(status: ContractLifecycleStatus, tag: string): Promise<{ contractId: string; documentId: string; txId: string }> {
  const fileObjectId = await cleanFile(tag);
  const c = await createContract(db.prisma, {
    actorId: initiator,
    correlationId: `c-${tag}`,
    typeCode: TYPE,
    title: `Sözleşme ${tag}`,
    counterpartyId: cpId,
    fileObjectId,
    now: NOW,
  });
  await db.prisma.workflowInstance.create({
    data: { definitionVersionId: defVersionId, subjectType: "CONTRACT", subjectId: c.contractId, status: "COMPLETED", startedById: initiator, endedAt: NOW },
  });
  await db.prisma.document.update({ where: { id: c.documentId }, data: { contractStatus: status } });
  const txId = `tx-${tag}-${randomUUID()}`;
  await linkExternalRecord(db.prisma, { sourceSystem: "esignature", externalId: txId, entityType: "Document", entityId: c.documentId, requestedById: initiator });
  return { contractId: c.contractId, documentId: c.documentId, txId };
}

function signedBytes(tag: string): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.4 imzali ${tag} ${randomUUID()}`);
}

async function statusOf(documentId: string): Promise<string | null> {
  return (await db.prisma.document.findUniqueOrThrow({ where: { id: documentId } })).contractStatus;
}

beforeAll(async () => {
  db = await startTestDb();
  const p = db.prisma;
  await p.documentType.create({
    data: { code: TYPE, name: "Sözleşme", defaultConfidentiality: "CONFIDENTIAL", requiredMetadataKeys: ["counterpartyId"], updatedAt: NOW } as never,
  });
  await p.metadataDefinition.create({ data: { key: "counterpartyId", label: "Karşı taraf", dataType: "REFERENCE", enumValues: [], updatedAt: NOW } as never });
  await p.legalEntity.create({ data: { name: "EKOS Test A.Ş.", countryCode: "TR", updatedAt: NOW } as never });
  cpId = (await p.counterparty.create({ data: { officialName: "Test Tedarikçi Ltd.", countryCode: "TR", status: "ACTIVE", updatedAt: NOW } as never })).id;
  initiator = (await p.user.create({ data: { email: "esign-init@t.test", displayName: "Başlatan", updatedAt: NOW } })).id;
  const def = await p.workflowDefinition.create({ data: { code: "CONTRACT_APPROVAL", name: "Sözleşme onayı", updatedAt: NOW } });
  defVersionId = (await p.workflowDefinitionVersion.create({
    data: { definitionId: def.id, version: 1, status: "PUBLISHED", definition: { steps: [] }, publishedAt: NOW },
  })).id;
});

afterAll(async () => {
  await db.stop();
});

describe("e-imza → imzalı sözleşme sürümü", () => {
  it("bilinmeyen işlem kimliği sürüm üretmez (UNKNOWN_TRANSACTION)", async () => {
    const storage = new MemStorage();
    const r = await recordSignedVersion(db.prisma, storage, {
      transactionId: "tx-yok", signedAt: NOW, parties: [{ name: "A" }], signedFile: signedBytes("x"), signedFileSha256: "a".repeat(64), correlationId: "s0",
    });
    expect(r).toEqual({ status: "UNKNOWN_TRANSACTION" });
    expect(storage.map.size).toBe(0);
  });

  it("imzasız aşamadaki (DRAFT) sözleşmeye imzalı sürüm eklenmez", async () => {
    const s = await signableContract("DRAFT", "draft");
    const bytes = signedBytes("draft");
    await expect(
      recordSignedVersion(db.prisma, new MemStorage(), { transactionId: s.txId, signedAt: NOW, parties: [{ name: "A" }], signedFile: bytes, signedFileSha256: sha(bytes), correlationId: "s1" }),
    ).rejects.toMatchObject({ code: "TRANSITION_DENIED" });
    const versions = await db.prisma.documentVersion.count({ where: { documentId: s.documentId } });
    expect(versions).toBe(1);
  });

  let happy: { contractId: string; documentId: string; txId: string };
  let prevVersionId: string;
  let signedVersionId: string;
  const bytes = signedBytes("mutlu");
  const digest = sha(bytes);
  const storage = new MemStorage();

  it("tamamlanma olayı: imzalı sürüm eklenir, önceki sürüm kilitlenir, kanıt yazılır; tarama bekleniyorsa ACTIVE olmaz", async () => {
    happy = await signableContract("READY_FOR_SIGNATURE", "mutlu");
    const before = await db.prisma.document.findUniqueOrThrow({ where: { id: happy.documentId } });
    prevVersionId = before.currentVersionId ?? "";
    const r = await recordSignedVersion(db.prisma, storage, {
      transactionId: happy.txId, signedAt: NOW, parties: [{ name: "Ali Yılmaz" }, { name: "Ayşe Demir" }], signedFile: bytes, signedFileSha256: digest, correlationId: "s2",
    });
    expect(r.status).toBe("RECORDED");
    if (r.status !== "RECORDED") return;
    expect(r.versionNumber).toBe(2);
    expect(r.duplicate).toBe(false);
    expect(r.activated).toBe(false);
    expect(await statusOf(happy.documentId)).toBe("PENDING_SIGNATURE");

    const doc = await db.prisma.document.findUniqueOrThrow({ where: { id: happy.documentId } });
    signedVersionId = doc.currentVersionId ?? "";
    const signed = await db.prisma.documentVersion.findUniqueOrThrow({ where: { id: signedVersionId } });
    expect(signed.isSigned).toBe(true);
    expect(signed.isReadOnly).toBe(true);
    expect(signed.sha256).toBe(digest);
    const prev = await db.prisma.documentVersion.findUniqueOrThrow({ where: { id: prevVersionId } });
    expect(prev.isReadOnly).toBe(true);
    expect(prev.supersededAt).not.toBeNull();
    expect(doc.ingestStatus).toBe("QUARANTINED");

    const ev = await db.prisma.contractSignatureEvidence.findUniqueOrThrow({ where: { documentVersionId: signedVersionId } });
    expect(ev.signerSummary).toBe("Ali Yılmaz, Ayşe Demir");
    expect(ev.contractId).toBe(happy.contractId);
    expect(storage.map.size).toBe(1);
  });

  it("aynı imzalı dosya ikinci kez gelirse yeni sürüm üretilmez (idempotent)", async () => {
    const r = await recordSignedVersion(db.prisma, storage, {
      transactionId: happy.txId, signedAt: NOW, parties: [{ name: "Ali Yılmaz" }], signedFile: bytes, signedFileSha256: digest, correlationId: "s3",
    });
    expect(r.status).toBe("RECORDED");
    if (r.status === "RECORDED") {
      expect(r.duplicate).toBe(true);
      expect(r.versionNumber).toBe(2);
    }
    expect(await db.prisma.documentVersion.count({ where: { documentId: happy.documentId } })).toBe(2);
    expect(await db.prisma.contractSignatureEvidence.count({ where: { contractId: happy.contractId } })).toBe(1);
    expect(storage.map.size).toBe(1);
  });

  it("imzalı sürüm doğrudan değiştirilemez (VERSION_LOCKED)", async () => {
    const d = await db.prisma.document.findUniqueOrThrow({ where: { id: happy.documentId } });
    const file = await cleanFile("yeni-sürüm");
    await expect(
      createNewVersion(db.prisma, { actorId: initiator, correlationId: "s4", documentId: happy.documentId, expectedRowVersion: d.rowVersion, fileObjectId: file, reason: "değişiklik" }),
    ).rejects.toBeInstanceOf(DomainError);
    await expect(
      createNewVersion(db.prisma, { actorId: initiator, correlationId: "s5", documentId: happy.documentId, expectedRowVersion: d.rowVersion, fileObjectId: file, reason: "değişiklik" }),
    ).rejects.toMatchObject({ code: "VERSION_LOCKED" });
  });

  it("tarama CLEAN olunca sözleşme ACTIVE olur; denetim kullanıcı e-postası içermez", async () => {
    const quarantined = await db.prisma.documentVersion.findUniqueOrThrow({ where: { id: signedVersionId } });
    expect(quarantined.fileObjectId).not.toBeNull();
    const res = await scanFile({ prisma: db.prisma, storage, av: new FakeAv() }, { fileObjectId: quarantined.fileObjectId ?? "", actorId: null, correlationId: "s6" });
    expect(res.status).toBe("CLEAN");
    expect(await statusOf(happy.documentId)).toBe("ACTIVE");
    const audits = await db.prisma.auditEvent.findMany({ where: { correlationId: { in: ["s2", "s3"] } } });
    for (const a of audits) expect(JSON.stringify(a.afterSummary ?? {})).not.toContain("@");
    expect(audits.some((a) => a.eventType === "CONTRACT_SIGNED_VERSION_RECORDED")).toBe(true);
  });

  it("tarama INFECTED ise sözleşme ACTIVE olmaz", async () => {
    const s = await signableContract("READY_FOR_SIGNATURE", "virus");
    const b = signedBytes("virus");
    const st = new MemStorage();
    const r = await recordSignedVersion(db.prisma, st, { transactionId: s.txId, signedAt: NOW, parties: [{ name: "A" }], signedFile: b, signedFileSha256: sha(b), correlationId: "s7" });
    if (r.status !== "RECORDED" || r.fileObjectId === null) throw new Error("kayıt bekleniyordu");
    const av = new FakeAv();
    av.next = { status: "INFECTED", signature: "Test.Signature" };
    const res = await scanFile({ prisma: db.prisma, storage: st, av }, { fileObjectId: r.fileObjectId, actorId: null, correlationId: "s8" });
    expect(res.status).toBe("INFECTED");
    expect(await statusOf(s.documentId)).toBe("PENDING_SIGNATURE");
  });

  it("tarayıcı yapılandırılmamış/erişilemez (UNAVAILABLE) ise sözleşme ACTIVE olmaz", async () => {
    const s = await signableContract("READY_FOR_SIGNATURE", "unavail");
    const b = signedBytes("unavail");
    const st = new MemStorage();
    const r = await recordSignedVersion(db.prisma, st, { transactionId: s.txId, signedAt: NOW, parties: [{ name: "A" }], signedFile: b, signedFileSha256: sha(b), correlationId: "s9" });
    if (r.status !== "RECORDED" || r.fileObjectId === null) throw new Error("kayıt bekleniyordu");
    const av = new FakeAv();
    av.next = { status: "UNAVAILABLE", reason: "clamd kapalı" };
    const res = await scanFile({ prisma: db.prisma, storage: st, av }, { fileObjectId: r.fileObjectId, actorId: null, correlationId: "s10" });
    expect(res.status).toBe("UNAVAILABLE");
    expect(await statusOf(s.documentId)).toBe("PENDING_SIGNATURE");
  });

  it("manuel imza yolu (R-LC-04) hâlâ çalışır: kanıtla ACTIVE", async () => {
    const s = await signableContract("READY_FOR_SIGNATURE", "manuel");
    await recordSignatureAndActivate(db.prisma, { contractId: s.contractId, actorId: initiator, correlationId: "s11", signedAt: NOW, signatureMethod: "ISLAK_IMZA", signerSummary: "Yetkili" });
    expect(await statusOf(s.documentId)).toBe("ACTIVE");
  });
});
