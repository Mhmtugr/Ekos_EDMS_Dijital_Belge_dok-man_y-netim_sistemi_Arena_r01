// İmha akışı (Faz 4, madde 3): süre dolumu → inceleme kuyruğu → inceleyen → ikinci ve FARKLI onaycı → yürütücü.
// Yürütme: dosya nesneleri, sürümler, OCR işleri, çıkarımlar, metadata değerleri ve arama metni silinir;
// içeriksiz DisposalManifest (sha256'lı) saklanır. Otomatik (insansız) imha YOKTUR: en az iki insan kararı zorunludur.
import { checkDisposalApprovers, isCalendarDate, uuidv7, type ActorContext, type ObjectStoragePort } from "@ekos/core";
import type { PrismaClient } from "@prisma/client";
import { verifyAuditTable } from "../audit.js";
import { guardDocument } from "../documents/guard.js";
import { DomainError } from "../documents/shared.js";
import { documentVisibilitySql } from "../documents/visibility.js";
import { canonicalSha256, istanbulDate, recordDenied } from "./common.js";
import { appendAudit } from "../audit.js";
import { computeDisposalEligibility } from "./retention.js";
import { loadFiscalYearMap } from "./fiscal.js";

const OPEN_STATUSES = ["PENDING_REVIEW", "BLOCKED", "APPROVED"] as const;
const MANIFEST_SCHEMA = "EKOS_DISPOSAL_MANIFEST_V1";

export interface ScanSummary {
  readonly examined: number;
  readonly queued: number;
  readonly blockedOpened: number;
  readonly unblocked: number;
  readonly blockedNow: number;
  readonly notDue: number;
  /** Profil eksik/doğrulanmamış (politika eksiği): otomatik imha edilemez, yalnızca uyarı. */
  readonly policyGap: number;
}

/**
 * Süre dolumu tarama işi (sistem). İdempotenttir: aynı durumda yeni denetim kaydı yazmaz.
 * Açık incelemeleri de güncel engellerle senkron tutar (engel eklenince BLOCKED, kalkınca kuyruğa döner).
 */
export async function scanDispositionCandidates(
  prisma: PrismaClient,
  input: { now: Date; correlationId: string; fiscalYearEndByYear?: Readonly<Record<string, string>> },
): Promise<ScanSummary> {
  const auditReady = (await verifyAuditTable(prisma)).ok;
  const fyMap = input.fiscalYearEndByYear ?? (await loadFiscalYearMap(prisma));
  const today = istanbulDate(input.now);
  const candidates = await prisma.document.findMany({
    where: { lifecycleProfile: "GENERAL", retentionProfileId: { not: null }, generalStatus: { not: "DISPOSED" }, ingestStatus: "READY" },
    select: { id: true },
  });
  const summary = { examined: 0, queued: 0, blockedOpened: 0, unblocked: 0, blockedNow: 0, notDue: 0, policyGap: 0 };

  for (const c of candidates) {
    summary.examined += 1;
    await prisma.$transaction(async (tx) => {
      const r = await computeDisposalEligibility(tx, {
        documentId: c.id,
        now: input.now,
        auditReady,
        fiscalYearEndByYear: fyMap,
      });
      const blocks = r.eligibility.blocks;
      const blockedReason = blocks.length > 0 ? blocks.join(",") : null;
      if (blocks.some((b) => b === "NO_RETENTION_PROFILE" || b === "PROFILE_NOT_VERIFIED" || b === "PROFILE_INCOMPLETE")) summary.policyGap += 1;

      const extended = await tx.dispositionReview.findFirst({
        where: { documentId: c.id, status: "EXTENDED", extendedUntil: { gt: new Date(`${today}T00:00:00Z`) } },
      });
      if (extended) return;

      const open = await tx.dispositionReview.findFirst({ where: { documentId: c.id, status: { in: [...OPEN_STATUSES] } } });
      if (open) {
        if (open.status === "PENDING_REVIEW" && blocks.length > 0) {
          await tx.dispositionReview.update({ where: { id: open.id }, data: { status: "BLOCKED", blockedReason, rowVersion: { increment: 1 } } });
          await appendAudit(tx, { actorType: "SYSTEM", actorId: null, eventType: "DISPOSAL_REVIEW_BLOCKED", targetType: "DOCUMENT", targetId: c.id, outcome: "SUCCESS", reason: blockedReason, correlationId: input.correlationId, afterSummary: { reviewId: open.id, blocks } });
          summary.blockedNow += 1;
        } else if (open.status === "BLOCKED" && blocks.length === 0) {
          await tx.dispositionReview.update({ where: { id: open.id }, data: { status: "PENDING_REVIEW", blockedReason: null, rowVersion: { increment: 1 } } });
          await appendAudit(tx, { actorType: "SYSTEM", actorId: null, eventType: "DISPOSAL_REVIEW_UNBLOCKED", targetType: "DOCUMENT", targetId: c.id, outcome: "SUCCESS", correlationId: input.correlationId, afterSummary: { reviewId: open.id } });
          summary.unblocked += 1;
        } else if (open.blockedReason !== blockedReason) {
          await tx.dispositionReview.update({ where: { id: open.id }, data: { blockedReason } });
        }
        return;
      }

      const due = r.eligibility.dueDate !== null && today >= r.eligibility.dueDate;
      if (!due) {
        summary.notDue += 1;
        return;
      }
      const status = blocks.length > 0 ? "BLOCKED" : "PENDING_REVIEW";
      const reviewId = uuidv7();
      await tx.dispositionReview.create({
        data: {
          id: reviewId,
          documentId: c.id,
          status,
          blockedReason,
          retentionDueAt: r.eligibility.dueDate ? new Date(`${r.eligibility.dueDate}T00:00:00Z`) : null,
          retentionProfileId: r.profileId,
          createdBy: null,
        },
      });
      await tx.document.update({ where: { id: c.id }, data: { generalStatus: "DISPOSAL_REVIEW", rowVersion: { increment: 1 } } });
      await appendAudit(tx, {
        actorType: "SYSTEM", actorId: null, eventType: status === "BLOCKED" ? "DISPOSAL_REVIEW_BLOCKED" : "DISPOSAL_REVIEW_QUEUED",
        targetType: "DOCUMENT", targetId: c.id, outcome: "SUCCESS", reason: blockedReason, correlationId: input.correlationId,
        afterSummary: { reviewId, status, dueDate: r.eligibility.dueDate, profileCode: r.profileCode },
      });
      if (status === "BLOCKED") summary.blockedOpened += 1;
      else summary.queued += 1;
    });
  }
  return summary;
}

/** İnceleme kuyruğu: yalnızca kullanıcının GÖRDÜĞÜ belgeler (sorgu içi görünürlük filtresi). */
export async function listDispositionQueue(prisma: PrismaClient, input: { actor: ActorContext; now: Date }) {
  return prisma.$queryRaw<
    { reviewId: string; documentId: string; number: string; status: string; blockedReason: string | null; retentionDueAt: Date | null; extendedUntil: Date | null; rowVersion: number }[]
  >`
    SELECT r."id" AS "reviewId", d."id" AS "documentId", d."number", r."status"::text AS "status",
           r."blockedReason", r."retentionDueAt", r."extendedUntil", r."rowVersion"
    FROM "DispositionReview" r
    JOIN "Document" d ON d."id" = r."documentId"
    WHERE r."status" IN ('PENDING_REVIEW', 'BLOCKED', 'APPROVED') AND ${documentVisibilitySql(input.actor, input.now)}
    ORDER BY r."retentionDueAt" ASC NULLS LAST`;
}

async function loadReviewForDecision(prisma: PrismaClient, reviewId: string) {
  const review = await prisma.dispositionReview.findUnique({
    where: { id: reviewId },
    include: { decisions: true, document: { select: { id: true, number: true, generalStatus: true, departmentId: true, typeId: true, confidentiality: true } } },
  });
  if (!review) throw new DomainError("NOT_FOUND");
  return review;
}

/**
 * İnceleme kararı. Rol sırası: ilk karar REVIEWER (document.retention_review); ikinci karar SECOND_APPROVER
 * (document.disposal_approve) ve FARKLI kişi olmak zorundadır (ayrılık ilkesi). Her iki rol de profilin
 * imha onaycı listesinde olmalıdır. APPROVE yalnızca tüm engeller kalktığında verilebilir.
 */
export async function decideDispositionReview(
  prisma: PrismaClient,
  input: {
    actor: ActorContext; now: Date; correlationId: string; reviewId: string; expectedRowVersion: number;
    decision: "APPROVE" | "EXTEND" | "REJECT"; reason: string; extendedUntil?: string | null; physicalEvidenceRef?: string | null;
  },
): Promise<{ status: string; role: "REVIEWER" | "SECOND_APPROVER" }> {
  const review = await loadReviewForDecision(prisma, input.reviewId);
  const denyAndThrow = async (code: "NOT_PROFILE_APPROVER" | "SEPARATION_OF_DUTIES" | "DISPOSAL_BLOCKED" | "LEGAL_HOLD_ACTIVE" | "NO_PERMISSION", err: DomainError): Promise<never> => {
    await recordDenied(prisma, { actorId: input.actor.userId, eventType: "DISPOSAL_DECISION_DENIED", targetType: "DOCUMENT", targetId: review.documentId, reason: code, correlationId: input.correlationId });
    throw err;
  };

  if (review.status !== "PENDING_REVIEW") throw new DomainError("DISPOSAL_STATE_INVALID", "İnceleme karar bekleyen durumda değil");
  if (review.rowVersion !== input.expectedRowVersion) throw new DomainError("VERSION_CONFLICT");
  if (review.decisions.some((d) => d.actorId === input.actor.userId)) {
    await denyAndThrow("SEPARATION_OF_DUTIES", new DomainError("SEPARATION_OF_DUTIES", "Aynı incelemede ikinci kez karar verilemez"));
  }
  const role: "REVIEWER" | "SECOND_APPROVER" = review.decisions.some((d) => d.role === "REVIEWER") ? "SECOND_APPROVER" : "REVIEWER";
  const reviewerDecision = review.decisions.find((d) => d.role === "REVIEWER") ?? null;
  if (role === "SECOND_APPROVER") {
    if (!reviewerDecision || reviewerDecision.decision !== "APPROVE") throw new DomainError("DISPOSAL_STATE_INVALID", "İnceleyen onayı yok");
    if (reviewerDecision.actorId === input.actor.userId) {
      await denyAndThrow("SEPARATION_OF_DUTIES", new DomainError("SEPARATION_OF_DUTIES", "İnceleyen ve ikinci onaycı aynı kişi olamaz"));
    }
  }

  const profile = review.retentionProfileId
    ? await prisma.retentionProfile.findUnique({ where: { id: review.retentionProfileId } })
    : null;
  if (!profile) throw new DomainError("DISPOSAL_BLOCKED", "Profil yok");
  if (!profile.disposalApproverIds.includes(input.actor.userId)) {
    await denyAndThrow("NOT_PROFILE_APPROVER", new DomainError("FORBIDDEN", "Bu kişi profilin imha onaycısı değil"));
  }

  const permission = role === "REVIEWER" ? "document.retention_review" : "document.disposal_approve";
  try {
    await guardDocument(prisma, { actor: input.actor, now: input.now, documentId: review.documentId, permission });
  } catch (err) {
    if (err instanceof DomainError) {
      await recordDenied(prisma, { actorId: input.actor.userId, eventType: "DISPOSAL_DECISION_DENIED", targetType: "DOCUMENT", targetId: review.documentId, reason: err.code === "NOT_FOUND" ? "NOT_VISIBLE" : "NO_PERMISSION", correlationId: input.correlationId });
    }
    throw err;
  }

  const reason = input.reason.trim();
  if (!reason) throw new DomainError("REASON_REQUIRED");

  const today = istanbulDate(input.now);
  let extendedUntil: string | null = null;
  if (input.decision === "EXTEND") {
    if (!input.extendedUntil || !isCalendarDate(input.extendedUntil) || input.extendedUntil <= today) {
      throw new DomainError("PROFILE_INVALID", "Uzatma tarihi bugünden sonra bir takvim günü olmalı");
    }
    extendedUntil = input.extendedUntil;
  }

  if (input.decision === "APPROVE") {
    const auditReady = (await verifyAuditTable(prisma)).ok;
    const gate = await prisma.$transaction(async (tx) => computeDisposalEligibility(tx, { documentId: review.documentId, now: input.now, auditReady }));
    if (gate.eligibility.blocks.length > 0) {
      const hold = gate.legalHoldCount > 0;
      await denyAndThrow(
        hold ? "LEGAL_HOLD_ACTIVE" : "DISPOSAL_BLOCKED",
        hold
          ? new DomainError("LEGAL_HOLD_ACTIVE", "Yasal bekletme aktifken imha onaylanamaz")
          : new DomainError("DISPOSAL_BLOCKED", `İmha onaylanamaz: ${gate.eligibility.blocks.join(", ")}`),
      );
    }
  }

  let physicalEvidenceRef: string | null = null;
  if (role === "SECOND_APPROVER" && input.decision === "APPROVE" && profile.disposalMethod === "PHYSICAL_DESTRUCTION_RECORD") {
    physicalEvidenceRef = input.physicalEvidenceRef?.trim() || null;
    if (!physicalEvidenceRef) throw new DomainError("PHYSICAL_EVIDENCE_REQUIRED", "Fiziksel imha kanıt referansı zorunludur");
  }

  let nextStatus: "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "EXTENDED";
  if (role === "REVIEWER" && input.decision === "APPROVE") nextStatus = "PENDING_REVIEW";
  else if (input.decision === "APPROVE") nextStatus = "APPROVED";
  else if (input.decision === "REJECT") nextStatus = "REJECTED";
  else nextStatus = "EXTENDED";

  await prisma.$transaction(async (tx) => {
    const upd = await tx.dispositionReview.updateMany({
      where: { id: review.id, rowVersion: input.expectedRowVersion, status: "PENDING_REVIEW" },
      data: {
        status: nextStatus,
        extendedUntil: extendedUntil ? new Date(`${extendedUntil}T00:00:00Z`) : null,
        ...(physicalEvidenceRef ? { physicalEvidenceRef } : {}),
        rowVersion: { increment: 1 },
      },
    });
    if (upd.count !== 1) throw new DomainError("VERSION_CONFLICT");
    await tx.dispositionDecision.create({
      data: { id: uuidv7(), reviewId: review.id, actorId: input.actor.userId, role, decision: input.decision, reason, decidedAt: input.now },
    });
    if (nextStatus === "REJECTED" || nextStatus === "EXTENDED") {
      await tx.document.update({ where: { id: review.documentId }, data: { generalStatus: "ARCHIVED", rowVersion: { increment: 1 } } });
    }
    await appendAudit(tx, {
      actorType: "USER", actorId: input.actor.userId, eventType: "DISPOSAL_DECISION_RECORDED", targetType: "DOCUMENT", targetId: review.documentId,
      outcome: "SUCCESS", reason, correlationId: input.correlationId,
      afterSummary: { reviewId: review.id, role, decision: input.decision, status: nextStatus, extendedUntil },
    });
  });
  return { status: nextStatus, role };
}

/** Yürütme planı: yalnızca okunur hesaplar. Tüm kontroller yürütme işleminde kilit altında yeniden yapılır. */
export interface ExecutionResult {
  readonly status: "EXECUTED" | "BLOCKED" | "SKIPPED" | "FAILED";
  readonly reviewId: string;
  readonly reason?: string;
  readonly counts?: Record<string, number>;
  readonly manifestSha256?: string;
}

/**
 * İmha yürütücüsü (worker). YALNIZCA APPROVED incelemeleri yürütür. Her şey tek bir işlemde yapılır:
 * belge satırı kilitlenir → engeller yeniden kontrol edilir → veritabanı kayıtları silinir → nesneler
 * depodan silinir (hata olursa işlem geri alınır) → içeriksiz manifest yazılır.
 */
export async function runDispositionWorker(
  prisma: PrismaClient,
  input: { storage: ObjectStoragePort; now: Date; correlationId: string; reviewId?: string },
): Promise<ExecutionResult[]> {
  const reviews = await prisma.dispositionReview.findMany({
    where: { status: "APPROVED", ...(input.reviewId ? { id: input.reviewId } : {}) },
    select: { id: true },
    orderBy: { updatedAt: "asc" },
  });
  const out: ExecutionResult[] = [];
  for (const r of reviews) out.push(await executeOne(prisma, input, r.id));
  return out;
}

async function executeOne(
  prisma: PrismaClient,
  input: { storage: ObjectStoragePort; now: Date; correlationId: string },
  reviewId: string,
): Promise<ExecutionResult> {
  const auditReady = (await verifyAuditTable(prisma)).ok;
  try {
    return await prisma.$transaction(
      async (tx) => {
        const review = await tx.dispositionReview.findUnique({ where: { id: reviewId }, include: { decisions: true } });
        if (!review || review.status !== "APPROVED") return { status: "SKIPPED", reviewId };

        await tx.$queryRaw`SELECT "id" FROM "Document" WHERE "id" = ${review.documentId}::uuid FOR UPDATE`;

        const gate = await computeDisposalEligibility(tx, { documentId: review.documentId, now: input.now, auditReady });
        if (gate.eligibility.blocks.length > 0) {
          await appendAudit(tx, {
            actorType: "WORKER", actorId: null, eventType: "DISPOSAL_EXECUTION_DENIED", targetType: "DOCUMENT", targetId: review.documentId,
            outcome: "DENIED", reason: gate.eligibility.blocks.join(","), correlationId: input.correlationId, afterSummary: { reviewId },
          });
          return { status: "BLOCKED", reviewId, reason: gate.eligibility.blocks.join(",") };
        }

        const reviewer = review.decisions.find((d) => d.role === "REVIEWER" && d.decision === "APPROVE");
        const second = review.decisions.find((d) => d.role === "SECOND_APPROVER" && d.decision === "APPROVE");
        const violations = checkDisposalApprovers({ reviewerId: reviewer?.actorId ?? null, secondApproverId: second?.actorId ?? null });
        if (violations.length > 0) {
          return { status: "BLOCKED", reviewId, reason: violations.join(",") };
        }

        const doc = await tx.document.findUniqueOrThrow({
          where: { id: review.documentId },
          include: {
            type: { select: { code: true } },
            versions: { include: { fileObject: true } },
          },
        });
        const profile = review.retentionProfileId
          ? await tx.retentionProfile.findUnique({ where: { id: review.retentionProfileId } })
          : null;
        const latestRule = profile
          ? await tx.retentionRuleVersion.findFirst({ where: { profileId: profile.id }, orderBy: { version: "desc" } })
          : null;

        const fileObjects = doc.versions.map((v) => v.fileObject).filter((f): f is NonNullable<typeof f> => f !== null);
        const fileObjectIds = fileObjects.map((f) => f.id);
        const ocrJobs = fileObjectIds.length
          ? await tx.oCRJob.findMany({ where: { fileObjectId: { in: fileObjectIds } } })
          : [];
        const ocrKeys = ocrJobs.map((j) => j.resultStorageKey).filter((k): k is string => !!k);
        const extractionCount = await tx.extractionResult.count({ where: { documentId: doc.id } });
        const metadataCount = await tx.metadataValue.count({ where: { documentId: doc.id } });
        const aclCount = await tx.documentAcl.count({ where: { documentId: doc.id } });
        const counts = {
          versions: doc.versions.length,
          fileObjects: fileObjects.length,
          ocrResults: ocrKeys.length,
          ocrJobs: ocrJobs.length,
          extractionRows: extractionCount,
          metadataValues: metadataCount,
          aclRows: aclCount,
        };

        const manifestBody = {
          schema: MANIFEST_SCHEMA,
          reviewId: review.id,
          documentId: doc.id,
          documentNumber: doc.number,
          documentTypeCode: doc.type.code,
          retentionProfileId: profile?.id ?? null,
          retentionProfileCode: profile?.code ?? null,
          policyVersionNumber: latestRule?.version ?? null,
          startEvent: gate.startEvent,
          startDate: gate.startDate,
          dueDate: gate.eligibility.dueDate,
          disposalMethod: profile?.disposalMethod ?? null,
          physicalEvidenceRef: review.physicalEvidenceRef ?? null,
          versions: doc.versions.map((v) => ({
            versionNumber: v.versionNumber,
            sha256: v.sha256,
            isSigned: v.isSigned,
            fileObjectId: v.fileObjectId,
            mimeType: v.fileObject?.mimeType ?? null,
            byteSize: v.fileObject ? v.fileObject.byteSize.toString() : null,
          })),
          approvals: review.decisions
            .slice()
            .sort((a, b) => a.decidedAt.getTime() - b.decidedAt.getTime())
            .map((d) => ({ role: d.role, actorId: d.actorId, decision: d.decision, decidedAt: d.decidedAt.toISOString(), reason: d.reason })),
          deleted: counts,
          searchIndex: "CLEARED",
          executedAt: input.now.toISOString(),
          executedBy: "WORKER",
          result: "DELETED",
        };
        const manifestSha256 = canonicalSha256(manifestBody);

        // Kapsam bildirimi: veritabanı tetikleyicileri yalnızca bu belgenin ve bu dosya kimliklerinin silinmesine izin verir.
        await tx.$queryRaw`SELECT set_config('ekos.disposal_document_id', ${doc.id}, true), set_config('ekos.disposal_file_object_ids', ${fileObjectIds.join(",")}, true)`;

        await tx.extractionResult.deleteMany({ where: { documentId: doc.id } });
        await tx.metadataValue.deleteMany({ where: { documentId: doc.id } });
        await tx.documentAcl.deleteMany({ where: { documentId: doc.id } });
        await tx.oCRJob.deleteMany({ where: { fileObjectId: { in: fileObjectIds } } });
        // Belge kaydı tombstone olarak kalır: içerik ve arama metni boşaltılır, başlık imha işaretine çevrilir.
        await tx.document.update({
          where: { id: doc.id },
          data: {
            generalStatus: "DISPOSED",
            currentVersionId: null,
            searchText: "",
            title: `[İMHA EDİLDİ] ${doc.number}`,
            legalHoldActive: false,
            rowVersion: { increment: 1 },
          },
        });
        await tx.documentVersion.deleteMany({ where: { documentId: doc.id } });
        await tx.documentFileObject.deleteMany({ where: { id: { in: fileObjectIds } } });

        // Depo silmesi işlemin İÇİNDE: hata olursa veritabanı değişiklikleri geri alınır. Silme idempotenttir.
        for (const f of fileObjects) await input.storage.delete(f.storageKey);
        for (const k of ocrKeys) await input.storage.delete(k);

        await tx.disposalManifest.create({
          data: {
            id: uuidv7(),
            reviewId: review.id,
            manifest: manifestBody,
            manifestSha256,
            policyVersionId: latestRule?.id ?? null,
            executedAt: input.now,
            physicalEvidenceRef: review.physicalEvidenceRef ?? null,
          },
        });
        await tx.dispositionReview.update({ where: { id: review.id }, data: { status: "EXECUTED", rowVersion: { increment: 1 } } });
        await appendAudit(tx, {
          actorType: "WORKER", actorId: null, eventType: "DISPOSAL_EXECUTED", targetType: "DOCUMENT", targetId: doc.id,
          outcome: "SUCCESS", correlationId: input.correlationId,
          afterSummary: { reviewId: review.id, manifestSha256, counts, policyVersionNumber: latestRule?.version ?? null },
        });
        return { status: "EXECUTED", reviewId: review.id, counts, manifestSha256 };
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
  } catch (err) {
    const message = err instanceof DomainError ? err.code : "EXECUTION_FAILED";
    const doc = await prisma.dispositionReview.findUnique({ where: { id: reviewId }, select: { documentId: true } });
    await prisma.$transaction((tx) =>
      appendAudit(tx, {
        actorType: "WORKER", actorId: null, eventType: "DISPOSAL_EXECUTION_FAILED", targetType: "DOCUMENT", targetId: doc?.documentId ?? null,
        outcome: "FAILED", reason: message, correlationId: input.correlationId, afterSummary: { reviewId },
      }),
    );
    return { status: "FAILED", reviewId, reason: message };
  }
}

/** Manifest bütünlük doğrulaması: veritabanından okunan gövde kanonik biçimde yeniden özetlenir. */
export function verifyDisposalManifest(row: { manifest: unknown; manifestSha256: string }): boolean {
  return canonicalSha256(row.manifest) === row.manifestSha256;
}
