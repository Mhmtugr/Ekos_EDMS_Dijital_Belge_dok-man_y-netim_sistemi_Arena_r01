// Sözleşme yaşam döngüsü ve onay akışı servisleri (Faz 3). GERÇEK veritabanı; kurallar @ekos/core'dadır.
// R-LC-03/04/05/06, R-WF-01/02/03, R-DB-05, R-RNW-01.
import {
  checkApprovalDecision,
  checkApprovalMatrix,
  checkContractTransition,
  computeNoticeDeadline,
  uuidv7,
} from "@ekos/core";
import type { ContractLifecycleStatus, ContractTransitionContext, DecisionKind, MatrixStep } from "@ekos/core";
import type { Prisma} from "@prisma/client";
import { type PrismaClient } from "@prisma/client";
import { appendAudit } from "../audit.js";
import { createDocumentInTx, type Tx } from "../documents/create.js";
import { DomainError, requireActiveType, type MetadataInput } from "../documents/shared.js";

export const CONTRACT_APPROVAL_DEFINITION = "CONTRACT_APPROVAL";

const VIOLATION_TEXT: Record<string, string> = {
  TRANSITION_NOT_ALLOWED: "Bu durum geçişine izin verilmiyor",
  APPROVALS_INCOMPLETE: "Tüm onaylar tamamlanmadan hazır duruma geçilemez",
  SIGNATURE_EVIDENCE_MISSING: "İmza kanıtı olmadan sözleşme aktif edilemez",
  HISTORICAL_NOT_APPROVABLE: "Geçmiş (içe aktarılmış) kayıt onay akışına alınamaz",
  INVALID_REQUIRES_AUTHORITY_AND_REASON: "Geçersiz işaretleme yetkili ve gerekçeli olmalıdır",
  NO_APPROVAL_MATRIX: "Onay matrisi tanımlı değil; akış başlatılamaz",
  STEP_WITHOUT_APPROVER: "Onay matrisinde onaycısız adım var",
  INVALID_REQUIRED_APPROVALS: "Onay matrisinde gereken onay sayısı geçersiz",
  SELF_APPROVAL_BLOCKED: "Akışı başlatan kişi kendi onayını veremez",
  NOT_ASSIGNEE: "Bu onay görevi size atanmamış",
  REASON_REQUIRED: "Red ve geri gönderme için gerekçe zorunludur",
};

function fail(violation: string): never {
  const code = violation === "REASON_REQUIRED" ? "REASON_REQUIRED" : violation === "SELF_APPROVAL_BLOCKED" || violation === "NOT_ASSIGNEE" ? "DECISION_DENIED" : violation === "NO_APPROVAL_MATRIX" || violation === "STEP_WITHOUT_APPROVER" || violation === "INVALID_REQUIRED_APPROVALS" ? "WORKFLOW_NOT_STARTABLE" : "TRANSITION_DENIED";
  throw new DomainError(code, VIOLATION_TEXT[violation] ?? violation);
}

async function loadContract(tx: Tx, contractId: string) {
  const contract = await tx.contractRecord.findUnique({ where: { id: contractId }, include: { document: true } });
  if (!contract) throw new DomainError("NOT_FOUND");
  if (contract.document.lifecycleProfile !== "CONTRACT" || !contract.document.contractStatus) throw new DomainError("NOT_FOUND");
  return contract;
}

async function transitionContext(tx: Tx, contractId: string, origin: "MANUAL" | "IMPORTED_HISTORICAL", invalidWithAuthorityAndReason?: boolean): Promise<ContractTransitionContext> {
  const latest = await tx.workflowInstance.findFirst({
    where: { subjectType: "CONTRACT", subjectId: contractId },
    orderBy: { startedAt: "desc" },
  });
  const evidence = await tx.contractSignatureEvidence.count({ where: { contractId, documentVersion: { isSigned: true } } });
  return {
    origin,
    allApprovalsCompleted: latest?.status === "COMPLETED",
    hasSignatureEvidence: evidence > 0,
    ...(invalidWithAuthorityAndReason !== undefined ? { invalidWithAuthorityAndReason } : {}),
  };
}

async function setContractStatus(tx: Tx, documentId: string, to: ContractLifecycleStatus, actorId: string, correlationId: string, from: ContractLifecycleStatus, reason: string | null) {
  await tx.document.update({
    where: { id: documentId },
    data: { contractStatus: to, rowVersion: { increment: 1 }, updatedBy: actorId },
  });
  await appendAudit(tx, {
    actorType: "USER",
    actorId,
    eventType: "CONTRACT_STATUS_CHANGED",
    targetType: "DOCUMENT",
    targetId: documentId,
    outcome: "SUCCESS",
    correlationId,
    reason,
    afterSummary: { from, to },
  });
}

/** Tek geçiş: tablo + kurallar denetlenir, sonra yazılır. */
async function moveContract(
  tx: Tx,
  contractId: string,
  to: ContractLifecycleStatus,
  actorId: string,
  correlationId: string,
  opts: { reason?: string | null; invalidAuthority?: boolean } = {},
): Promise<void> {
  const contract = await loadContract(tx, contractId);
  const from = contract.document.contractStatus as ContractLifecycleStatus;
  const origin = contract.origin;
  const ctx = await transitionContext(tx, contractId, origin, opts.invalidAuthority);
  const res = checkContractTransition(from, to, ctx);
  if (!res.ok) fail(res.violation);
  if (to === "INVALID" && (opts.reason ?? "").trim().length === 0) fail("INVALID_REQUIRES_AUTHORITY_AND_REASON");
  await setContractStatus(tx, contract.documentId, to, actorId, correlationId, from, opts.reason?.trim() ?? null);
}

export interface CreateContractInput {
  readonly actorId: string;
  readonly correlationId: string;
  readonly typeCode: string;
  readonly title: string;
  readonly counterpartyId: string;
  readonly metadata?: MetadataInput;
  readonly departmentId?: string | null;
  readonly origin?: "MANUAL" | "IMPORTED_HISTORICAL";
  readonly fileObjectId?: string | null;
  readonly now?: Date;
}

/** Sözleşme kaydı: Document (CONTRACT profili) + ContractRecord. Geçmiş içe aktarım ARCHIVED olarak başlar (onay gibi görünmez). */
export async function createContract(prisma: PrismaClient, input: CreateContractInput): Promise<{ contractId: string; documentId: string; number: string; status: ContractLifecycleStatus }> {
  return prisma.$transaction(async (tx) => {
    const type = await requireActiveType(tx, input.typeCode);
    const legal = await tx.legalEntity.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" } });
    if (!legal) throw new DomainError("NOT_FOUND", "Aktif tüzel kişi tanımlı değil");
    const cp = await tx.counterparty.findUnique({ where: { id: input.counterpartyId } });
    if (!cp || cp.status !== "ACTIVE") throw new DomainError("RELATION_INVALID", "Karşı taraf yok veya pasif");

    const origin = input.origin ?? "MANUAL";
    const doc = await createDocumentInTx(tx, {
      actorId: input.actorId,
      correlationId: input.correlationId,
      typeCode: input.typeCode,
      title: input.title,
      metadata: { ...(input.metadata ?? {}), counterpartyId: input.counterpartyId },
      departmentId: input.departmentId ?? null,
      fileObjectId: input.fileObjectId ?? null,
      ...(input.now ? { now: input.now } : {}),
    });
    const status: ContractLifecycleStatus = origin === "IMPORTED_HISTORICAL" ? "ARCHIVED" : "DRAFT";
    await tx.document.update({
      where: { id: doc.documentId },
      data: { lifecycleProfile: "CONTRACT", generalStatus: null, contractStatus: status },
    });
    const contractId = uuidv7();
    await tx.contractRecord.create({
      data: {
        id: contractId,
        documentId: doc.documentId,
        title: input.title.trim(),
        contractType: type.code,
        direction: "OTHER",
        counterpartyId: input.counterpartyId,
        legalEntityId: legal.id,
        departmentId: input.departmentId ?? null,
        origin,
        fieldSource: "MANUAL",
        createdBy: input.actorId,
        updatedBy: input.actorId,
      },
    });
    await appendAudit(tx, {
      actorType: "USER",
      actorId: input.actorId,
      eventType: "CONTRACT_CREATED",
      targetType: "ContractRecord",
      targetId: contractId,
      outcome: "SUCCESS",
      correlationId: input.correlationId,
      afterSummary: { origin, status, number: doc.number },
    });
    return { contractId, documentId: doc.documentId, number: doc.number, status };
  });
}

/**
 * Onay akışını başlatır. R-WF-01: örnek, o anda YAYINLANMIŞ tanım sürümüne sabitlenir.
 * R-WF-02: yayınlanmış sürüm ve geçerli onay matrisi yoksa başlatılamaz.
 * R-LC-06: geçmiş kayıt onay akışına alınamaz.
 */
export async function startContractApproval(prisma: PrismaClient, input: { contractId: string; actorId: string; correlationId: string; now?: Date }): Promise<{ instanceId: string; definitionVersionId: string }> {
  return prisma.$transaction(async (tx) => {
    const contract = await loadContract(tx, input.contractId);
    const from = contract.document.contractStatus as ContractLifecycleStatus;
    if (from === "DRAFT") await moveContract(tx, contract.id, "IN_REVIEW", input.actorId, input.correlationId);
    await moveContract(tx, contract.id, "PENDING_APPROVAL", input.actorId, input.correlationId);

    const def = await tx.workflowDefinition.findUnique({ where: { code: CONTRACT_APPROVAL_DEFINITION } });
    if (!def || !def.isActive) fail("NO_APPROVAL_MATRIX");
    const version = await tx.workflowDefinitionVersion.findFirst({
      where: { definitionId: def.id, status: "PUBLISHED" },
      orderBy: { version: "desc" },
    });
    if (!version) fail("NO_APPROVAL_MATRIX");

    const parsed = parseMatrix(version.definition);
    const check = checkApprovalMatrix(parsed);
    if (!check.ok) fail(check.violation);

    const approverIds = [...new Set(parsed.flatMap((s) => [...s.approverIds]))];
    const active = await tx.user.count({ where: { id: { in: approverIds }, status: "ACTIVE" } });
    if (active !== approverIds.length) fail("NOT_ASSIGNEE");

    const instanceId = uuidv7();
    await tx.workflowInstance.create({
      data: {
        id: instanceId,
        definitionVersionId: version.id,
        subjectType: "CONTRACT",
        subjectId: contract.id,
        status: "ACTIVE",
        startedById: input.actorId,
      },
    });
    for (const s of parsed) {
      const stepId = uuidv7();
      await tx.workflowStep.create({
        data: { id: stepId, instanceId, orderIndex: s.orderIndex, mode: "SEQUENTIAL", quorum: "ALL", requiredApprovals: s.requiredApprovals, status: "PENDING" },
      });
      await tx.approvalTask.createMany({
        data: s.approverIds.map((assigneeId) => ({ id: uuidv7(), stepId, assigneeId, status: "PENDING" as const })),
      });
    }
    await appendAudit(tx, {
      actorType: "USER",
      actorId: input.actorId,
      eventType: "WORKFLOW_STARTED",
      targetType: "WorkflowInstance",
      targetId: instanceId,
      outcome: "SUCCESS",
      correlationId: input.correlationId,
      afterSummary: { definitionVersionId: version.id, steps: parsed.length, subject: contract.id },
    });
    return { instanceId, definitionVersionId: version.id };
  });
}

function parseMatrix(definition: Prisma.JsonValue): MatrixStep[] {
  const steps = (definition as { steps?: unknown } | null)?.steps;
  if (!Array.isArray(steps)) return [];
  return steps.map((raw, i) => {
    const s = raw as { orderIndex?: unknown; approverIds?: unknown; requiredApprovals?: unknown };
    return {
      orderIndex: typeof s.orderIndex === "number" ? s.orderIndex : i + 1,
      approverIds: Array.isArray(s.approverIds) ? s.approverIds.map(String) : [],
      requiredApprovals: typeof s.requiredApprovals === "number" ? s.requiredApprovals : 0,
    };
  });
}

/**
 * Onay kararı. Sıralı adımlar: önceki adım tamamlanmadan karar verilemez.
 * REJECT → örnek REJECTED, sözleşme CANCELLED. RETURN → örnek RETURNED, sözleşme IN_REVIEW (gerekçe zorunlu).
 * Tüm adımlar tamamlanırsa → COMPLETED; sözleşme READY_FOR_SIGNATURE'a geçer (R-LC-03 denetimiyle).
 */
export async function decideApprovalTask(
  prisma: PrismaClient,
  input: { taskId: string; actorId: string; decision: DecisionKind; reason?: string | null; correlationId: string; allowSelfApproval?: boolean; now?: Date },
): Promise<{ instanceStatus: string; contractStatus: string }> {
  return prisma.$transaction(async (tx) => {
    const task = await tx.approvalTask.findUnique({ where: { id: input.taskId }, include: { step: { include: { instance: true } } } });
    if (!task) throw new DomainError("NOT_FOUND");
    const instance = task.step.instance;
    if (instance.status !== "ACTIVE") throw new DomainError("WORKFLOW_NOT_STARTABLE", "Örnek aktif değil");
    if (task.status !== "PENDING") throw new DomainError("VERSION_CONFLICT", "Görev zaten karara bağlanmış");

    // Vekalet (Faz 5): atanan kişi görevi aktif bir vekalet kapsamında başkasına devrettiyse karar verebilir.
    // Karar kaydı vekilin adına yazılır; devreden kişi denetim özetinde (delegatedFromId) görünür.
    const now = input.now ?? new Date();
    let delegatedFromId: string | null = null;
    if (input.actorId !== task.assigneeId) {
      const via = await tx.delegation.findFirst({
        where: { delegatorId: task.assigneeId, delegateId: input.actorId, revokedAt: null, startsAt: { lte: now }, endsAt: { gt: now }, scope: { path: ["approval"], equals: true } },
      });
      if (via) delegatedFromId = task.assigneeId;
    }

    const check = checkApprovalDecision(input.decision, input.reason ?? null, {
      actorId: input.actorId,
      taskAssigneeId: delegatedFromId ? input.actorId : task.assigneeId,
      initiatorId: instance.startedById,
      ...(input.allowSelfApproval !== undefined ? { allowSelfApproval: input.allowSelfApproval } : {}),
    });
    if (!check.ok) fail(check.violation);

    // Sıralama: önceki adımların tamamlanmış olması şarttır.
    const earlier = await tx.workflowStep.findMany({
      where: { instanceId: instance.id, orderIndex: { lt: task.step.orderIndex } },
    });
    if (earlier.some((s) => s.status !== "APPROVED")) throw new DomainError("DECISION_DENIED", "Önceki onay adımı tamamlanmadı");

    const reason = input.reason?.trim() ?? null;
    await tx.approvalTask.update({
      where: { id: task.id },
      data: { status: input.decision === "APPROVE" ? "APPROVED" : input.decision === "REJECT" ? "REJECTED" : "RETURNED", rowVersion: { increment: 1 } },
    });
    await tx.approvalDecision.create({
      data: { id: uuidv7(), taskId: task.id, decision: input.decision, reason, actorId: input.actorId },
    });
    await appendAudit(tx, {
      actorType: "USER",
      actorId: input.actorId,
      eventType: "APPROVAL_DECIDED",
      targetType: "ApprovalTask",
      targetId: task.id,
      outcome: "SUCCESS",
      correlationId: input.correlationId,
      reason,
      afterSummary: { decision: input.decision, delegatedFromId },
    });

    const contractId = instance.subjectId;

    if (input.decision !== "APPROVE") {
      const instStatus = input.decision === "REJECT" ? "REJECTED" : "RETURNED";
      await tx.workflowInstance.update({ where: { id: instance.id }, data: { status: instStatus, endedAt: new Date(), endReason: reason, rowVersion: { increment: 1 } } });
      await tx.approvalTask.updateMany({ where: { step: { instanceId: instance.id }, status: "PENDING" }, data: { status: "CANCELLED" } });
      const contract = await loadContract(tx, contractId);
      const to: ContractLifecycleStatus = input.decision === "REJECT" ? "CANCELLED" : "IN_REVIEW";
      await moveContract(tx, contract.id, to, input.actorId, input.correlationId, { reason });
      return { instanceStatus: instStatus, contractStatus: to };
    }

    // Adım tamamlandı mı? (requiredApprovals kadar APPROVED)
    const approvedInStep = await tx.approvalTask.count({ where: { stepId: task.stepId, status: "APPROVED" } });
    if (approvedInStep >= task.step.requiredApprovals) {
      await tx.workflowStep.update({ where: { id: task.stepId }, data: { status: "APPROVED" } });
      await tx.approvalTask.updateMany({ where: { stepId: task.stepId, status: "PENDING" }, data: { status: "CANCELLED" } });
    }
    const remaining = await tx.workflowStep.count({ where: { instanceId: instance.id, status: { not: "APPROVED" } } });
    if (remaining === 0) {
      await tx.workflowInstance.update({ where: { id: instance.id }, data: { status: "COMPLETED", endedAt: new Date(), rowVersion: { increment: 1 } } });
      await moveContract(tx, contractId, "READY_FOR_SIGNATURE", input.actorId, input.correlationId);
      return { instanceStatus: "COMPLETED", contractStatus: "READY_FOR_SIGNATURE" };
    }
    const contract = await loadContract(tx, contractId);
    return { instanceStatus: "ACTIVE", contractStatus: contract.document.contractStatus ?? "PENDING_APPROVAL" };
  });
}

/**
 * İmza kanıtını kaydeder ve sözleşmeyi ACTIVE yapar. R-LC-04: kanıt yoksa ACTIVE olmaz (kanıt aynı işlemde yazılır).
 * R-LC-05: imzalı sürüm kilitlenir (isSigned + isReadOnly).
 */
export async function recordSignatureAndActivate(
  prisma: PrismaClient,
  input: { contractId: string; actorId: string; correlationId: string; signedAt: Date; signatureMethod: string; signerSummary: string },
): Promise<{ status: string; versionId: string }> {
  return prisma.$transaction(async (tx) => {
    const contract = await loadContract(tx, input.contractId);
    const from = contract.document.contractStatus as ContractLifecycleStatus;
    if (from === "READY_FOR_SIGNATURE") await moveContract(tx, contract.id, "PENDING_SIGNATURE", input.actorId, input.correlationId);
    else if (from !== "PENDING_SIGNATURE") throw new DomainError("TRANSITION_DENIED", "Sözleşme imza aşamasında değil");

    if (input.signatureMethod.trim().length === 0 || input.signerSummary.trim().length === 0) {
      throw new DomainError("REQUIRED_METADATA_MISSING", "İmza yöntemi ve imzacı bilgisi zorunludur");
    }
    const doc = await tx.document.findUniqueOrThrow({ where: { id: contract.documentId } });
    const version = doc.currentVersionId ? await tx.documentVersion.findUnique({ where: { id: doc.currentVersionId } }) : null;
    if (!version) throw new DomainError("NOT_FOUND", "Geçerli sürüm yok");
    // Tarama kapısı: taranmamış (PENDING/INFECTED) dosya imzalanamaz. Dev'de tarama yapılandırılmadıysa imza yapılamaz (sahte "temiz" yok).
    const sigFile = version.fileObjectId ? await tx.documentFileObject.findUnique({ where: { id: version.fileObjectId } }) : null;
    if (!sigFile || sigFile.scanStatus !== "CLEAN") {
      throw new DomainError("TRANSITION_DENIED", `Sözleşme dosyası taramadan geçmeden imzalanamaz (tarama durumu: ${sigFile?.scanStatus ?? "YOK"})`);
    }

    await tx.contractSignatureEvidence.create({
      data: {
        id: uuidv7(),
        contractId: contract.id,
        documentVersionId: version.id,
        signedAt: input.signedAt,
        signatureMethod: input.signatureMethod.trim(),
        signerSummary: input.signerSummary.trim(),
        recordedById: input.actorId,
      },
    });
    await tx.documentVersion.update({ where: { id: version.id }, data: { isSigned: true, isReadOnly: true } });
    await appendAudit(tx, {
      actorType: "USER",
      actorId: input.actorId,
      eventType: "CONTRACT_SIGNED",
      targetType: "DocumentVersion",
      targetId: version.id,
      targetVersion: version.versionNumber,
      outcome: "SUCCESS",
      correlationId: input.correlationId,
      afterSummary: { method: input.signatureMethod.trim() },
    });
    await moveContract(tx, contract.id, "ACTIVE", input.actorId, input.correlationId);
    return { status: "ACTIVE", versionId: version.id };
  });
}

/** Yenileme/ihbar tarihi (R-RNW-01). Kural yalnızca hem doğrulanmış hem onaylanmışsa kullanılır. */
export async function getNoticeDeadline(prisma: PrismaClient, contractId: string): Promise<string> {
  const contract = await prisma.contractRecord.findUnique({
    where: { id: contractId },
    include: { renewalRules: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!contract) throw new DomainError("NOT_FOUND");
  const rule = contract.renewalRules[0];
  const endDate = contract.endDate ? contract.endDate.toISOString().slice(0, 10) : null;
  return computeNoticeDeadline(endDate, {
    verified: !!(rule && rule.verifiedAt && rule.approvedAt),
    noticeValue: rule?.noticeValue ?? null,
    noticeUnit: rule?.noticeUnit ?? null,
  });
}

// ---- Sözleşme alanlarının düzenlenmesi (Faz 5) ----
// Tarih, tutar, yenileme ve ihbar alanları yalnız TASLAK veya İNCELEMEDE iken değiştirilir. Onay sürecine girmiş veya
// yürürlükteki sözleşmenin alanları, değişiklik (zeyilname) akışıyla değişir; burada sessizce değiştirilmez.
// Bitiş tarihi değişince hatırlatma motoru bir sonraki döngüde eski planları iptal eder ve yenilerini üretir (reminders.ts).

export interface ContractFieldsInput {
  readonly effectiveDate?: string | null;
  readonly startDate?: string | null;
  readonly endDate?: string | null;
  readonly autoRenewal?: boolean | null;
  readonly amount?: string | null;
  readonly currency?: string | null;
  readonly paymentTerms?: string | null;
  readonly noticePeriodValue?: number | null;
  readonly noticePeriodUnit?: "CALENDAR_DAYS" | "CALENDAR_MONTHS" | null;
}

const EDITABLE_STATES: readonly string[] = ["DRAFT", "IN_REVIEW"];
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

function isoDate(v: string): Date {
  if (!ISO_RE.test(v)) throw new DomainError("VALIDATION_FAILED", "Tarih YYYY-AA-GG biçiminde olmalı");
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw new DomainError("VALIDATION_FAILED", "Geçersiz tarih");
  return d;
}

export async function updateContractFields(
  prisma: PrismaClient,
  input: {
    actor: { userId: string };
    correlationId: string;
    contractId: string;
    expectedRowVersion: number;
    fields: ContractFieldsInput;
  },
): Promise<{ rowVersion: number }> {
  const f = input.fields;
  // Doğrulama (veritabanına gitmeden).
  const data: Prisma.ContractRecordUpdateInput = {};
  if (f.effectiveDate !== undefined) data.effectiveDate = f.effectiveDate ? isoDate(f.effectiveDate) : null;
  if (f.startDate !== undefined) data.startDate = f.startDate ? isoDate(f.startDate) : null;
  if (f.endDate !== undefined) data.endDate = f.endDate ? isoDate(f.endDate) : null;
  if (f.autoRenewal !== undefined) data.autoRenewal = f.autoRenewal;
  if (f.paymentTerms !== undefined) data.paymentTerms = f.paymentTerms ? f.paymentTerms.slice(0, 1000) : null;
  if (f.amount !== undefined || f.currency !== undefined) {
    const amount = f.amount ?? null;
    const currency = f.currency ? f.currency.toUpperCase() : null;
    if ((amount === null) !== (currency === null)) throw new DomainError("VALIDATION_FAILED", "Tutar ve para birimi birlikte girilmelidir");
    if (amount !== null) {
      if (!/^\d{1,15}(\.\d{1,4})?$/.test(amount)) throw new DomainError("VALIDATION_FAILED", "Tutar geçersiz (ör. 15000.00)");
      if (!/^[A-Z]{3}$/.test(currency ?? "")) throw new DomainError("VALIDATION_FAILED", "Para birimi ISO 4217 (3 harf) olmalı");
    }
    data.amount = amount;
    data.currency = currency;
  }
  if (f.noticePeriodValue !== undefined || f.noticePeriodUnit !== undefined) {
    const v = f.noticePeriodValue ?? null;
    const u = f.noticePeriodUnit ?? null;
    if ((v === null) !== (u === null)) throw new DomainError("VALIDATION_FAILED", "İhbar süresi ve birimi birlikte girilmelidir");
    if (v !== null && (!Number.isInteger(v) || v < 1 || v > 3650)) throw new DomainError("VALIDATION_FAILED", "İhbar süresi 1–3650 arası tam sayı olmalı");
    data.noticePeriodValue = v;
    data.noticePeriodUnit = u;
  }

  return prisma.$transaction(async (tx) => {
    const c = await tx.contractRecord.findUnique({ where: { id: input.contractId }, include: { document: { select: { contractStatus: true } } } });
    if (!c) throw new DomainError("NOT_FOUND");
    if (c.rowVersion !== input.expectedRowVersion) throw new DomainError("VERSION_CONFLICT");
    const status = c.document.contractStatus ?? "";
    if (!EDITABLE_STATES.includes(status)) {
      throw new DomainError("TRANSITION_DENIED", "Alanlar yalnız taslak veya incelemedeki sözleşmede değiştirilebilir; yürürlükteki sözleşme için değişiklik (zeyilname) akışı kullanılır");
    }
    const effectiveStart = data.startDate !== undefined ? (data.startDate as Date | null) : c.startDate;
    const effectiveEnd = data.endDate !== undefined ? (data.endDate as Date | null) : c.endDate;
    if (effectiveStart && effectiveEnd && effectiveEnd < effectiveStart) {
      throw new DomainError("VALIDATION_FAILED", "Bitiş tarihi başlangıç tarihinden önce olamaz");
    }
    const updated = await tx.contractRecord.update({
      where: { id: c.id },
      data: { ...data, rowVersion: { increment: 1 }, updatedBy: input.actor.userId, fieldSource: "MANUAL" },
    });
    await appendAudit(tx, {
      actorType: "USER",
      actorId: input.actor.userId,
      eventType: "CONTRACT_FIELDS_UPDATED",
      targetType: "ContractRecord",
      targetId: c.id,
      outcome: "SUCCESS",
      correlationId: input.correlationId,
      beforeSummary: { endDate: c.endDate?.toISOString().slice(0, 10) ?? null, startDate: c.startDate?.toISOString().slice(0, 10) ?? null },
      afterSummary: { endDate: updated.endDate?.toISOString().slice(0, 10) ?? null, startDate: updated.startDate?.toISOString().slice(0, 10) ?? null, fields: Object.keys(data) },
    });
    return { rowVersion: updated.rowVersion };
  });
}

// ---- E-imza tamamlanma sürümü (Faz 7 açık boşluk 1) ----
// İmzalı dosya sağlayıcıdan geldiğinde: SHA-256 doğrulanmış bayt karantinaya yazılır, belgeye YENİ bir imzalı sürüm
// eklenir (önceki sürüm kilitlenir, R-LC-05), kanıt kaydı aynı işlemde yazılır (R-LC-04). Sözleşme YALNIZ imzalı
// dosya tarama CLEAN olduğunda ACTIVE olur; tarama bekleniyorsa sözleşme PENDING_SIGNATURE kalır.

export interface AttachSignedVersionInput {
  readonly documentId: string;
  /** Sürümü ve kanıtı denetime bağlayan kullanıcı: e-imza talebini başlatan kişi. */
  readonly actorId: string;
  readonly correlationId: string;
  readonly transactionId: string;
  readonly signedAt: Date;
  readonly signerNames: readonly string[];
  readonly signedFileSha256: string;
  readonly storageKey: string;
  readonly originalFileName: string;
  readonly byteSize: number;
}

export type AttachSignedVersionResult =
  | { readonly status: "CREATED"; readonly versionId: string; readonly versionNumber: number; readonly fileObjectId: string }
  | { readonly status: "DUPLICATE"; readonly versionId: string; readonly versionNumber: number; readonly fileObjectId: string | null };

/** Aynı SHA-256 ile imzalı sürüm varsa yeni sürüm üretilmez (idempotent). */
export async function attachSignedVersionInTx(tx: Tx, input: AttachSignedVersionInput): Promise<AttachSignedVersionResult> {
  const existing = await tx.documentVersion.findFirst({
    where: { documentId: input.documentId, isSigned: true, sha256: input.signedFileSha256 },
    orderBy: { versionNumber: "desc" },
  });
  if (existing) {
    return { status: "DUPLICATE", versionId: existing.id, versionNumber: existing.versionNumber, fileObjectId: existing.fileObjectId };
  }
  const contract = await tx.contractRecord.findUnique({ where: { documentId: input.documentId }, include: { document: true } });
  if (!contract || contract.document.lifecycleProfile !== "CONTRACT") throw new DomainError("NOT_FOUND", "Sözleşme kaydı bulunamadı");
  const from = contract.document.contractStatus;
  if (from === "READY_FOR_SIGNATURE") {
    await moveContract(tx, contract.id, "PENDING_SIGNATURE", input.actorId, input.correlationId);
  } else if (from !== "PENDING_SIGNATURE") {
    throw new DomainError("TRANSITION_DENIED", "Sözleşme imza aşamasında değil");
  }

  const doc = await tx.document.findUniqueOrThrow({ where: { id: input.documentId } });
  const prev = doc.currentVersionId ? await tx.documentVersion.findUnique({ where: { id: doc.currentVersionId } }) : null;
  if (!prev) throw new DomainError("NOT_FOUND", "Geçerli sürüm yok");

  const fileObjectId = uuidv7();
  await tx.documentFileObject.create({
    data: {
      id: fileObjectId,
      storageKey: input.storageKey,
      storagePrefix: "quarantine",
      originalFileName: input.originalFileName.slice(0, 260),
      mimeType: "application/pdf",
      byteSize: BigInt(input.byteSize),
      sha256: input.signedFileSha256,
      scanStatus: "PENDING",
      createdBy: input.actorId,
    },
  });

  const versionNumber = prev.versionNumber + 1;
  await tx.documentVersion.update({ where: { id: prev.id }, data: { isReadOnly: true, supersededAt: new Date() } });
  const versionId = uuidv7();
  await tx.documentVersion.create({
    data: {
      id: versionId,
      documentId: doc.id,
      versionNumber,
      fileObjectId,
      sha256: input.signedFileSha256,
      isReadOnly: true,
      isSigned: true,
      changeReason: "E-imza tamamlandı: imzalı sürüm",
      createdBy: input.actorId,
    },
  });
  // İmzalı dosya da taranmadan kullanılamaz: belge karantinaya alınır (tarama CLEAN → süreç devam eder).
  await tx.document.update({
    where: { id: doc.id },
    data: { currentVersionId: versionId, ingestStatus: "QUARANTINED", rowVersion: { increment: 1 }, updatedBy: input.actorId },
  });

  const signerSummary = input.signerNames.map((n) => n.trim()).filter((n) => n.length > 0).join(", ").slice(0, 1000);
  await tx.contractSignatureEvidence.create({
    data: {
      id: uuidv7(),
      contractId: contract.id,
      documentVersionId: versionId,
      signedAt: input.signedAt,
      signatureMethod: "E-İMZA (sağlayıcı tamamlanma kaydı)",
      signerSummary: signerSummary.length > 0 ? signerSummary : "Taraflar sağlayıcı kaydında",
      recordedById: input.actorId,
    },
  });
  await appendAudit(tx, {
    actorType: "USER",
    actorId: input.actorId,
    eventType: "CONTRACT_SIGNED_VERSION_RECORDED",
    targetType: "DOCUMENT",
    targetId: doc.id,
    targetVersion: versionNumber,
    outcome: "SUCCESS",
    correlationId: input.correlationId,
    afterSummary: { transactionId: input.transactionId, signedAt: input.signedAt.toISOString(), sha256: input.signedFileSha256 },
  });
  return { status: "CREATED", versionId, versionNumber, fileObjectId };
}

/**
 * Sözleşme imzalıysa ve imzalı sürümün dosyası CLEAN ise ACTIVE yapar. Koşul sağlanmıyorsa sessizce false döner
 * (hiçbir durum değişmez). Denetim, talebi başlatan kullanıcı adına yazılır.
 */
export async function activateSignedContractInTx(tx: Tx, documentId: string, correlationId: string): Promise<boolean> {
  const contract = await tx.contractRecord.findUnique({ where: { documentId }, include: { document: true } });
  if (!contract || contract.document.contractStatus !== "PENDING_SIGNATURE") return false;
  const current = contract.document.currentVersionId
    ? await tx.documentVersion.findUnique({ where: { id: contract.document.currentVersionId } })
    : null;
  if (!current || !current.isSigned || !current.fileObjectId) return false;
  const file = await tx.documentFileObject.findUnique({ where: { id: current.fileObjectId } });
  if (!file || file.scanStatus !== "CLEAN") return false;
  const evidence = await tx.contractSignatureEvidence.count({ where: { documentVersionId: current.id } });
  if (evidence === 0) return false;
  const requester = await tx.externalRecordRef.findFirst({
    where: { entityType: "Document", entityId: documentId, sourceSystem: "esignature" },
    orderBy: { createdAt: "desc" },
  });
  const actorId = requester?.requestedById ?? null;
  if (!actorId) return false;
  await moveContract(tx, contract.id, "ACTIVE", actorId, correlationId, { reason: "E-imza kanıtı ve imzalı dosya taraması tamamlandı" });
  return true;
}

/** Tarama CLEAN kararı sonrası: dosyanın imzalı sürümü varsa sözleşmeyi etkinleştirmeyi dener. */
export async function activateSignedContractForFileInTx(tx: Tx, fileObjectId: string, correlationId: string): Promise<boolean> {
  const version = await tx.documentVersion.findUnique({ where: { fileObjectId } });
  if (!version || !version.isSigned) return false;
  return activateSignedContractInTx(tx, version.documentId, correlationId);
}
