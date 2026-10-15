// Faz 3 entegrasyon testleri (GERÇEK PostgreSQL). R-LC-03/04/05/06, R-WF-01/02/03, R-DB-05, R-RNW-01.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DomainError } from "../documents/shared.js";
import { startTestDb, type TestDb } from "../testing/pg-harness.js";
import {
  createContract,
  decideApprovalTask,
  getNoticeDeadline,
  recordSignatureAndActivate,
  startContractApproval,
} from "./lifecycle.js";
import { createNewVersion } from "../documents/create.js";
import { uuidv7 } from "@ekos/core";

const NOW = new Date("2026-10-14T06:00:00Z");

let db: TestDb;
let initiator: string; // başlatan; aynı zamanda matris adım-1 onaycısı (kendi onayı engellenmeli)
let approverB: string;
let approverC: string;
let cpId: string;
const typeCode = "SOZLESME";

async function fileFor(tag: string): Promise<string> {
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
      scanStatus: "CLEAN",
      createdBy: initiator,
    },
  });
  return id;
}

async function publishMatrix(steps: { approverIds: string[]; requiredApprovals: number }[]): Promise<string> {
  const p = db.prisma;
  const def = await p.workflowDefinition.findUnique({ where: { code: "CONTRACT_APPROVAL" } }) ??
    (await p.workflowDefinition.create({ data: { code: "CONTRACT_APPROVAL", name: "Sözleşme onayı", updatedAt: NOW } }));
  const last = await p.workflowDefinitionVersion.findFirst({ where: { definitionId: def.id }, orderBy: { version: "desc" } });
  const version = (last?.version ?? 0) + 1;
  // Önceki yayımlanmış sürüm emekliye ayrılır (yalnızca bir yayın aktif).
  await p.workflowDefinitionVersion.updateMany({ where: { definitionId: def.id, status: "PUBLISHED" }, data: { status: "RETIRED" } });
  const created = await p.workflowDefinitionVersion.create({
    data: {
      definitionId: def.id,
      version,
      status: "PUBLISHED",
      definition: { steps: steps.map((s, i) => ({ orderIndex: i + 1, approverIds: s.approverIds, requiredApprovals: s.requiredApprovals })) },
      publishedAt: NOW,
    },
  });
  return created.id;
}

beforeAll(async () => {
  db = await startTestDb();
  const p = db.prisma;
  await p.documentType.create({
    data: { code: typeCode, name: "Sözleşme", defaultConfidentiality: "CONFIDENTIAL", requiredMetadataKeys: ["counterpartyId"], updatedAt: NOW } as never,
  });
  await p.metadataDefinition.create({ data: { key: "counterpartyId", label: "Karşı taraf", dataType: "REFERENCE", enumValues: [], updatedAt: NOW } as never });
  await p.legalEntity.create({ data: { name: "EKOS Test A.Ş.", countryCode: "TR", updatedAt: NOW } as never });
  const cp = await p.counterparty.create({ data: { officialName: "Test Tedarikçi Ltd.", countryCode: "TR", status: "ACTIVE", updatedAt: NOW } as never });
  cpId = cp.id;
  initiator = (await p.user.create({ data: { email: "init@t.test", displayName: "Başlatan", updatedAt: NOW } })).id;
  approverB = (await p.user.create({ data: { email: "b@t.test", displayName: "B", updatedAt: NOW } })).id;
  approverC = (await p.user.create({ data: { email: "c@t.test", displayName: "C", updatedAt: NOW } })).id;
});

afterAll(async () => {
  await db.stop();
});

async function expectDomain(promise: Promise<unknown>, code: string): Promise<void> {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(DomainError);
  expect((err as DomainError).code).toBe(code);
}

async function statusOf(documentId: string): Promise<string | null> {
  const d = await db.prisma.document.findUniqueOrThrow({ where: { id: documentId } });
  return d.contractStatus;
}

describe("R-WF-02 onay matrisi yoksa akış başlatılamaz", () => {
  it("hiç tanım/sürüm yokken başlatma reddedilir ve durum DRAFT kalır", async () => {
    const c = await createContract(db.prisma, { actorId: initiator, correlationId: "t1", typeCode, title: "Matrissiz", counterpartyId: cpId, metadata: {} });
    await expectDomain(startContractApproval(db.prisma, { contractId: c.contractId, actorId: initiator, correlationId: "t1" }), "WORKFLOW_NOT_STARTABLE");
    expect(await statusOf(c.documentId)).toBe("DRAFT");
  });
  it("yalnız TASLAK sürüm varsa yine reddedilir (yayımlanmamış matris kullanılmaz)", async () => {
    const def = await db.prisma.workflowDefinition.create({ data: { code: "CONTRACT_APPROVAL", name: "Sözleşme onayı", updatedAt: NOW } });
    await db.prisma.workflowDefinitionVersion.create({
      data: { definitionId: def.id, version: 1, status: "DRAFT", definition: { steps: [{ orderIndex: 1, approverIds: [approverB], requiredApprovals: 1 }] } },
    });
    const c = await createContract(db.prisma, { actorId: initiator, correlationId: "t1b", typeCode, title: "Taslak matris", counterpartyId: cpId, metadata: {} });
    await expectDomain(startContractApproval(db.prisma, { contractId: c.contractId, actorId: initiator, correlationId: "t1b" }), "WORKFLOW_NOT_STARTABLE");
    expect(await statusOf(c.documentId)).toBe("DRAFT");
  });
});

describe("R-WF-01/03 + akış tamamlanması + R-LC-03", () => {
  let contractId = "";
  let documentId = "";
  let v1 = "";
  let instanceId = "";

  it("yayımlı matris ile başlar; onaylar sıralı tamamlanır", async () => {
    // Adım-1: başlatan + B (ikisi de onaycı). Adım-2: C.
    v1 = await publishMatrix([
      { approverIds: [initiator, approverB], requiredApprovals: 1 },
      { approverIds: [approverC], requiredApprovals: 1 },
    ]);
    const c = await createContract(db.prisma, {
      actorId: initiator, correlationId: "t2", typeCode, title: "Ana sözleşme", counterpartyId: cpId,
      metadata: {}, fileObjectId: await fileFor("ana"),
    });
    contractId = c.contractId;
    documentId = c.documentId;
    const s = await startContractApproval(db.prisma, { contractId, actorId: initiator, correlationId: "t2" });
    instanceId = s.instanceId;
    expect(s.definitionVersionId).toBe(v1);
    expect(await statusOf(documentId)).toBe("PENDING_APPROVAL");
  });

  it("R-WF-03: başlatan kendi görevini onaylayamaz", async () => {
    const task = await db.prisma.approvalTask.findFirstOrThrow({ where: { assigneeId: initiator, step: { instanceId } } });
    await expectDomain(decideApprovalTask(db.prisma, { taskId: task.id, actorId: initiator, decision: "APPROVE", correlationId: "t3" }), "DECISION_DENIED");
  });

  it("sıra: adım-1 tamamlanmadan adım-2 onaylanamaz", async () => {
    const task = await db.prisma.approvalTask.findFirstOrThrow({ where: { assigneeId: approverC, step: { instanceId } } });
    await expectDomain(decideApprovalTask(db.prisma, { taskId: task.id, actorId: approverC, decision: "APPROVE", correlationId: "t3b" }), "DECISION_DENIED");
  });

  it("R-LC-03: onaylar eksikken READY_FOR_SIGNATURE yok (imza aşaması ulaşılamaz)", async () => {
    expect(await statusOf(documentId)).toBe("PENDING_APPROVAL");
  });

  it("R-DB-05: gerekçesiz RED reddedilir", async () => {
    const task = await db.prisma.approvalTask.findFirstOrThrow({ where: { assigneeId: approverB, step: { instanceId } } });
    await expectDomain(decideApprovalTask(db.prisma, { taskId: task.id, actorId: approverB, decision: "REJECT", reason: "  ", correlationId: "t4" }), "REASON_REQUIRED");
  });

  it("adım-1 B onayı ile tamamlanır; başlatanın bekleyen görevi iptal edilir", async () => {
    const task = await db.prisma.approvalTask.findFirstOrThrow({ where: { assigneeId: approverB, step: { instanceId } } });
    await decideApprovalTask(db.prisma, { taskId: task.id, actorId: approverB, decision: "APPROVE", correlationId: "t5" });
    const own = await db.prisma.approvalTask.findFirstOrThrow({ where: { assigneeId: initiator, step: { instanceId } } });
    expect(own.status).toBe("CANCELLED");
  });

  it("adım-2 onayı → COMPLETED → READY_FOR_SIGNATURE", async () => {
    const task = await db.prisma.approvalTask.findFirstOrThrow({ where: { assigneeId: approverC, step: { instanceId } } });
    const r = await decideApprovalTask(db.prisma, { taskId: task.id, actorId: approverC, decision: "APPROVE", correlationId: "t6" });
    expect(r).toEqual({ instanceStatus: "COMPLETED", contractStatus: "READY_FOR_SIGNATURE" });
    expect(await statusOf(documentId)).toBe("READY_FOR_SIGNATURE");
  });

  it("R-LC-04: imza kanıtı kaydedilmeden ACTIVE yok; kanıtla ACTIVE ve sürüm kilitlenir", async () => {
    await recordSignatureAndActivate(db.prisma, {
      contractId, actorId: initiator, correlationId: "t7", signedAt: NOW, signatureMethod: "ISLAK_IMZA_TARAMA", signerSummary: "Yetkili imzacı A",
    });
    expect(await statusOf(documentId)).toBe("ACTIVE");
    const d = await db.prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    const ver = await db.prisma.documentVersion.findUniqueOrThrow({ where: { id: d.currentVersionId ?? "" } });
    expect(ver.isSigned).toBe(true);
    expect(ver.isReadOnly).toBe(true);
  });

  it("R-LC-05: ACTIVE sözleşmenin sürümü doğrudan değiştirilemez", async () => {
    const d = await db.prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    await expectDomain(
      createNewVersion(db.prisma, {
        actorId: initiator, correlationId: "t8", documentId, expectedRowVersion: d.rowVersion,
        fileObjectId: await fileFor("yeni"), reason: "değişiklik",
      }),
      "VERSION_LOCKED",
    );
  });

  it("R-RNW-01: doğrulanmamış yenileme kuralı → NEEDS_MANUAL_VERIFICATION", async () => {
    await db.prisma.contractRecord.update({ where: { id: contractId }, data: { endDate: new Date("2027-03-31T00:00:00Z") } });
    await db.prisma.renewalRule.create({ data: { contractId, basis: "AUTO_RENEW", noticeValue: 30, noticeUnit: "CALENDAR_DAYS", rowVersion: 1 } });
    expect(await getNoticeDeadline(db.prisma, contractId)).toBe("NEEDS_MANUAL_VERIFICATION");
  });

  it("R-RNW-01: doğrulanmış ve onaylanmış kuralla tarih hesaplanır", async () => {
    await db.prisma.renewalRule.updateMany({ where: { contractId }, data: { verifiedAt: NOW, approvedAt: NOW, verifiedById: approverC, approvedById: approverC } });
    expect(await getNoticeDeadline(db.prisma, contractId)).toBe("2027-03-01");
  });
});

describe("R-WF-01 sürüm sabitleme ve red/iptal yolu", () => {
  it("başlamış örnek sonradan yayımlanan yeni sürümden etkilenmez", async () => {
    const c = await createContract(db.prisma, { actorId: initiator, correlationId: "t9", typeCode, title: "Sabit", counterpartyId: cpId, metadata: {}, fileObjectId: await fileFor("sabit") });
    const s = await startContractApproval(db.prisma, { contractId: c.contractId, actorId: initiator, correlationId: "t9" });
    const v2 = await publishMatrix([{ approverIds: [approverC], requiredApprovals: 1 }]);
    const inst = await db.prisma.workflowInstance.findUniqueOrThrow({ where: { id: s.instanceId } });
    expect(inst.definitionVersionId).toBe(s.definitionVersionId);
    expect(inst.definitionVersionId).not.toBe(v2);
  });

  it("R-DB-05: RED gerekçeyle kaydedilir; sözleşme CANCELLED olur", async () => {
    const latest = await db.prisma.workflowInstance.findFirstOrThrow({ where: { subjectType: "CONTRACT", status: "ACTIVE" }, orderBy: { startedAt: "desc" } });
    const task = await db.prisma.approvalTask.findFirstOrThrow({ where: { step: { instanceId: latest.id }, status: "PENDING", assigneeId: approverB } });
    const r = await decideApprovalTask(db.prisma, { taskId: task.id, actorId: approverB, decision: "REJECT", reason: "Fiyat yanlış", correlationId: "t10" });
    expect(r.instanceStatus).toBe("REJECTED");
    expect(r.contractStatus).toBe("CANCELLED");
    const dec = await db.prisma.approvalDecision.findUniqueOrThrow({ where: { taskId: task.id } });
    expect(dec.reason).toBe("Fiyat yanlış");
  });
});

describe("R-LC-06 geçmiş kayıt onay gibi gösterilmez", () => {
  it("içe aktarılmış geçmiş sözleşme arşiv durumunda başlar ve onaya alınamaz", async () => {
    const h = await createContract(db.prisma, { actorId: initiator, correlationId: "t11", typeCode, title: "Geçmiş", counterpartyId: cpId, metadata: {}, origin: "IMPORTED_HISTORICAL" });
    expect(h.status).toBe("ARCHIVED");
    await expectDomain(startContractApproval(db.prisma, { contractId: h.contractId, actorId: initiator, correlationId: "t11" }), "TRANSITION_DENIED");
    const cnt = await db.prisma.approvalTask.count({ where: { step: { instance: { subjectId: h.contractId } } } });
    expect(cnt).toBe(0);
  });
});
