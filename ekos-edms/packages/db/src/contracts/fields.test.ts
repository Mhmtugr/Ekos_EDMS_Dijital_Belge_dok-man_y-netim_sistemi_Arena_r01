// Sözleşme alanları servisi entegrasyon testleri (GERÇEK PostgreSQL): sürüm kontrolü, durum kapısı, doğrulama, denetim.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DomainError } from "../documents/shared.js";
import { startTestDb, type TestDb } from "../testing/pg-harness.js";
import { createContract, recordSignatureAndActivate, updateContractFields } from "./lifecycle.js";
import { uuidv7 } from "@ekos/core";

const NOW = new Date("2026-10-14T06:00:00Z");
let db: TestDb;
let actor: string;
let cpId: string;
const typeCode = "SOZLESME";
let seq = 0;
const cid = () => `fld-${String(++seq)}`;

async function code(p: Promise<unknown>): Promise<string> {
  const err = await p.then(() => null, (e: unknown) => e);
  if (err === null) return "NO_ERROR";
  expect(err).toBeInstanceOf(DomainError);
  return (err as DomainError).code;
}

async function newDraft(title: string): Promise<{ id: string; documentId: string }> {
  const c = await createContract(db.prisma, { actorId: actor, correlationId: cid(), typeCode, title, counterpartyId: cpId, metadata: {} });
  return { id: c.contractId, documentId: c.documentId };
}

beforeAll(async () => {
  db = await startTestDb();
  const p = db.prisma;
  await p.documentType.create({
    data: { code: typeCode, name: "Sözleşme", defaultConfidentiality: "CONFIDENTIAL", requiredMetadataKeys: ["counterpartyId"], updatedAt: NOW } as never,
  });
  await p.metadataDefinition.create({ data: { key: "counterpartyId", label: "Karşı taraf", dataType: "REFERENCE", enumValues: [], updatedAt: NOW } as never });
  await p.legalEntity.create({ data: { name: "EKOS Test A.Ş.", countryCode: "TR", isActive: true, updatedAt: NOW } as never });
  cpId = (await p.counterparty.create({ data: { officialName: "Alan Test Ltd.", countryCode: "TR", status: "ACTIVE", updatedAt: NOW } as never })).id;
  actor = (await p.user.create({ data: { email: "fields@t.test", displayName: "Alan", updatedAt: NOW } })).id;
});

afterAll(async () => {
  await db.stop();
});

describe("Sözleşme alanları: kayıt ve denetim", () => {
  it("geçerli alanlar kaydedilir, rowVersion artar ve CONTRACT_FIELDS_UPDATED denetim kaydı üretilir", async () => {
    const c = await newDraft("Alan kaydı");
    const before = await db.prisma.contractRecord.findUniqueOrThrow({ where: { id: c.id } });
    const res = await updateContractFields(db.prisma, {
      actor: { userId: actor },
      correlationId: cid(),
      contractId: c.id,
      expectedRowVersion: before.rowVersion,
      fields: { startDate: "2026-01-01", endDate: "2027-01-01", amount: "15000.00", currency: "try", noticePeriodValue: 30, noticePeriodUnit: "CALENDAR_DAYS", autoRenewal: true },
    });
    expect(res.rowVersion).toBe(before.rowVersion + 1);
    const after = await db.prisma.contractRecord.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.currency).toBe("TRY");
    expect(after.noticePeriodValue).toBe(30);
    expect(after.fieldSource).toBe("MANUAL");
    const audits = await db.prisma.auditEvent.findMany({ where: { targetId: c.id, eventType: "CONTRACT_FIELDS_UPDATED" } });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actorId).toBe(actor);
  });

  it("eski rowVersion ile yazma VERSION_CONFLICT verir ve kayıt değişmez", async () => {
    const c = await newDraft("Çakışma");
    const rec = await db.prisma.contractRecord.findUniqueOrThrow({ where: { id: c.id } });
    await updateContractFields(db.prisma, { actor: { userId: actor }, correlationId: cid(), contractId: c.id, expectedRowVersion: rec.rowVersion, fields: { paymentTerms: "30 gün" } });
    const e = await code(updateContractFields(db.prisma, { actor: { userId: actor }, correlationId: cid(), contractId: c.id, expectedRowVersion: rec.rowVersion, fields: { paymentTerms: "60 gün" } }));
    expect(e).toBe("VERSION_CONFLICT");
    const now = await db.prisma.contractRecord.findUniqueOrThrow({ where: { id: c.id } });
    expect(now.paymentTerms).toBe("30 gün");
  });

  it("bitiş tarihi başlangıçtan önce olamaz (VALIDATION_FAILED)", async () => {
    const c = await newDraft("Tarih");
    const rec = await db.prisma.contractRecord.findUniqueOrThrow({ where: { id: c.id } });
    const e = await code(updateContractFields(db.prisma, { actor: { userId: actor }, correlationId: cid(), contractId: c.id, expectedRowVersion: rec.rowVersion, fields: { startDate: "2026-05-01", endDate: "2026-04-01" } }));
    expect(e).toBe("VALIDATION_FAILED");
  });

  it("tutar ve para birimi birlikte girilmeli; tek başına tutar reddedilir", async () => {
    const c = await newDraft("Tutar");
    const rec = await db.prisma.contractRecord.findUniqueOrThrow({ where: { id: c.id } });
    const e = await code(updateContractFields(db.prisma, { actor: { userId: actor }, correlationId: cid(), contractId: c.id, expectedRowVersion: rec.rowVersion, fields: { amount: "100" } }));
    expect(e).toBe("VALIDATION_FAILED");
  });

  it("ihbar süresi değer ve birim birlikte; aralık 1–3650", async () => {
    const c = await newDraft("İhbar");
    const rec = await db.prisma.contractRecord.findUniqueOrThrow({ where: { id: c.id } });
    expect(await code(updateContractFields(db.prisma, { actor: { userId: actor }, correlationId: cid(), contractId: c.id, expectedRowVersion: rec.rowVersion, fields: { noticePeriodValue: 30 } }))).toBe("VALIDATION_FAILED");
    expect(await code(updateContractFields(db.prisma, { actor: { userId: actor }, correlationId: cid(), contractId: c.id, expectedRowVersion: rec.rowVersion, fields: { noticePeriodValue: 5000, noticePeriodUnit: "CALENDAR_DAYS" } }))).toBe("VALIDATION_FAILED");
  });

  it("geçersiz tarih biçimi reddedilir", async () => {
    const c = await newDraft("Biçim");
    const rec = await db.prisma.contractRecord.findUniqueOrThrow({ where: { id: c.id } });
    expect(await code(updateContractFields(db.prisma, { actor: { userId: actor }, correlationId: cid(), contractId: c.id, expectedRowVersion: rec.rowVersion, fields: { endDate: "2026-02-30" } }))).toBe("VALIDATION_FAILED");
  });

  it("yürürlükteki (ACTIVE) sözleşmede alanlar değiştirilemez (TRANSITION_DENIED)", async () => {
    const c = await newDraft("Yürürlükte");
    const rec = await db.prisma.contractRecord.findUniqueOrThrow({ where: { id: c.id } });
    await db.prisma.document.update({ where: { id: c.documentId }, data: { contractStatus: "ACTIVE" } });
    const e = await code(updateContractFields(db.prisma, { actor: { userId: actor }, correlationId: cid(), contractId: c.id, expectedRowVersion: rec.rowVersion, fields: { paymentTerms: "x" } }));
    expect(e).toBe("TRANSITION_DENIED");
  });

  it("bilinmeyen sözleşme NOT_FOUND döner", async () => {
    const e = await code(updateContractFields(db.prisma, { actor: { userId: actor }, correlationId: cid(), contractId: uuidv7(), expectedRowVersion: 1, fields: {} }));
    expect(e).toBe("NOT_FOUND");
  });
});

async function fileRow(tag: string, scanStatus: "PENDING" | "CLEAN" | "INFECTED"): Promise<string> {
  const id = uuidv7();
  await db.prisma.documentFileObject.create({
    data: {
      id,
      storageKey: `objects/${tag}-${id}`,
      storagePrefix: "objects",
      originalFileName: `${tag}.pdf`,
      mimeType: "application/pdf",
      byteSize: BigInt(100),
      sha256: id.replace(/-/g, "").padEnd(64, "0").slice(0, 64),
      scanStatus,
      createdBy: actor,
    },
  });
  return id;
}

describe("İmza kapısı: taranmamış dosya imzalanamaz", () => {
  it("PENDING dosyada imza reddedilir; CLEAN olunca imza ile ACTIVE olur", async () => {
    const fileObjectId = await fileRow("imza", "PENDING");
    const c = await createContract(db.prisma, { actorId: actor, correlationId: cid(), typeCode, title: "İmza kapısı", counterpartyId: cpId, metadata: {}, fileObjectId });
    // Yürürlük öncesi aşamaya doğrudan getirilir (onay akışı ayrı testlerde doğrulanır).
    await db.prisma.document.update({ where: { id: c.documentId }, data: { contractStatus: "READY_FOR_SIGNATURE" } });
    const sig = { contractId: c.contractId, actorId: actor, correlationId: cid(), signedAt: new Date("2026-10-10T00:00:00Z"), signatureMethod: "Islak imza", signerSummary: "Örnek Yetkili" };
    const err = await recordSignatureAndActivate(db.prisma, sig).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe("TRANSITION_DENIED");
    expect((err as DomainError).message).toContain("taramadan");
    const still = await db.prisma.document.findUniqueOrThrow({ where: { id: c.documentId } });
    expect(still.contractStatus).toBe("READY_FOR_SIGNATURE");

    await db.prisma.documentFileObject.update({ where: { id: fileObjectId }, data: { scanStatus: "CLEAN" } });
    const res = await recordSignatureAndActivate(db.prisma, sig);
    expect(res.status).toBe("ACTIVE");
  });
});
