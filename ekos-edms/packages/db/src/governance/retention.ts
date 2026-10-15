// Saklama profilleri (sürümlü), belge-profil ataması, tetikleyici olaylar ve imha uygunluk hesabı (Faz 4, madde 1).
// Evrensel varsayılan süre KODLANMAZ. Profil eksik/doğrulanmamışsa belge "politika eksiği" sayılır ve imha edilemez.
import {
  authorize,
  evaluateDisposalEligibility,
  isCalendarDate,
  resolveStartDate,
  uuidv7,
  type ActorContext,
  type DisposalEligibility,
  type RetentionProfileFacts,
  type RetentionStartEventKind,
  type RetentionUnit,
} from "@ekos/core";
import { type Prisma, type PrismaClient } from "@prisma/client";
import { verifyAuditTable, appendAudit } from "../audit.js";
import { guardDocument } from "../documents/guard.js";
import { DomainError } from "../documents/shared.js";
import { dateOnly, istanbulDate, requireGlobal, type Tx } from "./common.js";
import { loadFiscalYearMap } from "./fiscal.js";

const START_EVENTS: readonly RetentionStartEventKind[] = ["DOCUMENT_CREATED", "CONTRACT_END", "FISCAL_YEAR_END", "MANUAL_EVENT"];
const UNITS: readonly RetentionUnit[] = ["CALENDAR_DAYS", "CALENDAR_MONTHS", "CALENDAR_YEARS"];
const METHODS = ["DIGITAL_DELETE", "PHYSICAL_DESTRUCTION_RECORD"] as const;
/** Sözleşme yaşam döngüsünde "sonlanmış" sayılan durumlar (aktif sözleşme engeli bunların dışında kalır). */
const CONTRACT_TERMINAL = ["ARCHIVED", "CANCELLED", "TERMINATED", "EXPIRED", "DISPOSED", "INVALID"] as const;

export interface RetentionProfileInput {
  readonly code: string;
  readonly responsibleId?: string | null;
  readonly basisNote?: string | null;
  readonly startEvent?: RetentionStartEventKind | null;
  readonly durationValue?: number | null;
  readonly durationUnit?: RetentionUnit | null;
  readonly effectiveFrom: string;
  readonly reviewDueAt?: string | null;
  readonly disposalMethod?: (typeof METHODS)[number] | null;
  readonly requiresLegalReview?: boolean;
  /** İmha onaycıları (kullanıcı kimlikleri). En az iki farklı kişi. */
  readonly disposalApproverIds?: readonly string[];
}

interface ProfileRules {
  readonly responsibleId: string | null;
  readonly basisNote: string | null;
  readonly startEvent: RetentionStartEventKind | null;
  readonly durationValue: number | null;
  readonly durationUnit: RetentionUnit | null;
  readonly effectiveFrom: string;
  readonly reviewDueAt: string | null;
  readonly disposalMethod: (typeof METHODS)[number] | null;
  readonly requiresLegalReview: boolean;
  readonly disposalApproverIds: readonly string[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateRules(input: RetentionProfileInput): ProfileRules {
  if (!isCalendarDate(input.effectiveFrom)) throw new DomainError("PROFILE_INVALID", "Yürürlük tarihi geçersiz");
  if (input.reviewDueAt && !isCalendarDate(input.reviewDueAt)) throw new DomainError("PROFILE_INVALID", "Gözden geçirme tarihi geçersiz");
  if (input.startEvent && !START_EVENTS.includes(input.startEvent)) throw new DomainError("PROFILE_INVALID", "Başlangıç olayı geçersiz");
  if (input.disposalMethod && !METHODS.includes(input.disposalMethod)) throw new DomainError("PROFILE_INVALID", "İmha yöntemi geçersiz");
  if (input.durationUnit && !UNITS.includes(input.durationUnit)) throw new DomainError("PROFILE_INVALID", "Süre birimi geçersiz");
  const dv = input.durationValue ?? null;
  if (dv !== null && (!Number.isInteger(dv) || dv < 0)) throw new DomainError("PROFILE_INVALID", "Süre tam sayı ve sıfır veya pozitif olmalı");
  if ((dv === null) !== (input.durationUnit === null || input.durationUnit === undefined)) {
    throw new DomainError("PROFILE_INVALID", "Süre değeri ve birimi birlikte girilmeli ya da birlikte boş bırakılmalı (sınırsız)");
  }
  const approvers = [...new Set(input.disposalApproverIds ?? [])];
  if (approvers.some((x) => !UUID_RE.test(x))) throw new DomainError("PROFILE_INVALID", "Onaycı kimliği geçersiz");
  if (approvers.length > 10) throw new DomainError("PROFILE_INVALID", "En fazla on imha onaycısı tanımlanabilir");
  return {
    disposalApproverIds: approvers,
    responsibleId: input.responsibleId ?? null,
    basisNote: input.basisNote?.trim() ? input.basisNote.trim() : null,
    startEvent: input.startEvent ?? null,
    durationValue: dv,
    durationUnit: input.durationUnit ?? null,
    effectiveFrom: input.effectiveFrom,
    reviewDueAt: input.reviewDueAt ?? null,
    disposalMethod: input.disposalMethod ?? null,
    requiresLegalReview: input.requiresLegalReview ?? false,
  };
}

function snapshotOf(code: string, r: ProfileRules, verifiedByLegal: boolean) {
  return { code, ...r, verifiedByLegal };
}

/** Yeni saklama profili (verifiedByLegal=false). Kurum yapılandırması: config.manage. */
export async function createRetentionProfile(
  prisma: PrismaClient,
  input: { actor: ActorContext; now: Date; correlationId: string; profile: RetentionProfileInput },
): Promise<{ profileId: string; version: number }> {
  requireGlobal(input.actor, "config.manage", input.now);
  const rules = validateRules(input.profile);
  const code = input.profile.code.trim();
  if (!/^[A-Z0-9][A-Z0-9-]{1,58}$/.test(code)) throw new DomainError("PROFILE_INVALID", "Profil kodu büyük harf, rakam ve tire içermelidir");
  const id = uuidv7();
  return prisma.$transaction(async (tx) => {
    const exists = await tx.retentionProfile.findUnique({ where: { code } });
    if (exists) throw new DomainError("PROFILE_INVALID", "Bu profil kodu zaten var");
    await tx.retentionProfile.create({
      data: {
        id,
        code,
        responsibleId: rules.responsibleId,
        basisNote: rules.basisNote,
        startEvent: rules.startEvent,
        durationValue: rules.durationValue,
        durationUnit: rules.durationUnit,
        effectiveFrom: new Date(`${rules.effectiveFrom}T00:00:00Z`),
        reviewDueAt: rules.reviewDueAt ? new Date(`${rules.reviewDueAt}T00:00:00Z`) : null,
        disposalMethod: rules.disposalMethod,
        requiresLegalReview: rules.requiresLegalReview,
        disposalApproverIds: [...rules.disposalApproverIds],
        verifiedByLegal: false,
        createdBy: input.actor.userId,
        updatedBy: input.actor.userId,
      },
    });
    await tx.retentionRuleVersion.create({
      data: { profileId: id, version: 1, snapshot: snapshotOf(code, rules, false), validFrom: new Date(`${rules.effectiveFrom}T00:00:00Z`), createdBy: input.actor.userId },
    });
    await appendAudit(tx, {
      actorType: "USER", actorId: input.actor.userId, eventType: "RETENTION_PROFILE_CREATED", targetType: "RETENTION_PROFILE", targetId: id,
      outcome: "SUCCESS", correlationId: input.correlationId, afterSummary: { code, version: 1, verifiedByLegal: false },
    });
    return { profileId: id, version: 1 };
  });
}

/**
 * Kural güncellemesi: yeni sürüm (RetentionRuleVersion) yazılır; geçmiş sürümler değişmez.
 * Kural alanı değişen profilin hukuki doğrulaması SIFIRLANIR (yeniden doğrulanmalı).
 */
export async function updateRetentionProfile(
  prisma: PrismaClient,
  input: { actor: ActorContext; now: Date; correlationId: string; profileId: string; expectedRowVersion: number; profile: RetentionProfileInput },
): Promise<{ version: number; rowVersion: number; verifiedByLegal: false }> {
  requireGlobal(input.actor, "config.manage", input.now);
  const rules = validateRules(input.profile);
  return prisma.$transaction(async (tx) => {
    const cur = await tx.retentionProfile.findUnique({ where: { id: input.profileId } });
    if (!cur) throw new DomainError("NOT_FOUND");
    if (cur.rowVersion !== input.expectedRowVersion) throw new DomainError("VERSION_CONFLICT");
    const last = await tx.retentionRuleVersion.findFirst({ where: { profileId: cur.id }, orderBy: { version: "desc" } });
    const nextVersion = (last?.version ?? 0) + 1;
    const upd = await tx.retentionProfile.updateMany({
      where: { id: cur.id, rowVersion: input.expectedRowVersion },
      data: {
        responsibleId: rules.responsibleId,
        basisNote: rules.basisNote,
        startEvent: rules.startEvent,
        durationValue: rules.durationValue,
        durationUnit: rules.durationUnit,
        effectiveFrom: new Date(`${rules.effectiveFrom}T00:00:00Z`),
        reviewDueAt: rules.reviewDueAt ? new Date(`${rules.reviewDueAt}T00:00:00Z`) : null,
        disposalMethod: rules.disposalMethod,
        requiresLegalReview: rules.requiresLegalReview,
        disposalApproverIds: [...rules.disposalApproverIds],
        verifiedByLegal: false,
        rowVersion: { increment: 1 },
        updatedBy: input.actor.userId,
      },
    });
    if (upd.count !== 1) throw new DomainError("VERSION_CONFLICT");
    await tx.retentionRuleVersion.create({
      data: { profileId: cur.id, version: nextVersion, snapshot: snapshotOf(cur.code, rules, false), validFrom: new Date(`${rules.effectiveFrom}T00:00:00Z`), createdBy: input.actor.userId },
    });
    await appendAudit(tx, {
      actorType: "USER", actorId: input.actor.userId, eventType: "RETENTION_PROFILE_UPDATED", targetType: "RETENTION_PROFILE", targetId: cur.id,
      outcome: "SUCCESS", correlationId: input.correlationId,
      beforeSummary: { version: last?.version ?? 0, verifiedByLegal: cur.verifiedByLegal },
      afterSummary: { version: nextVersion, verifiedByLegal: false, reason: "KURAL_DEGISTI_YENIDEN_DOGRULAMA_GEREKIR" },
    });
    return { version: nextVersion, rowVersion: cur.rowVersion + 1, verifiedByLegal: false };
  });
}

/**
 * Hukuki doğrulama: yalnız eksiksiz, dayanak notu olan profil doğrulanabilir.
 * Yetki: contract.legal_review (hukuk inceleyicisi). Doğrulama, sürüm kaydına da yazılır.
 */
export async function verifyRetentionProfileByLegal(
  prisma: PrismaClient,
  input: { actor: ActorContext; now: Date; correlationId: string; profileId: string; expectedRowVersion: number },
): Promise<{ version: number }> {
  requireGlobal(input.actor, "contract.legal_review", input.now);
  return prisma.$transaction(async (tx) => {
    const cur = await tx.retentionProfile.findUnique({ where: { id: input.profileId } });
    if (!cur) throw new DomainError("NOT_FOUND");
    if (cur.rowVersion !== input.expectedRowVersion) throw new DomainError("VERSION_CONFLICT");
    if (!cur.basisNote || !cur.basisNote.trim()) throw new DomainError("PROFILE_INVALID", "Hukuki doğrulama için dayanak notu zorunludur");
    if (!cur.startEvent || cur.durationValue === null || !cur.durationUnit || !cur.disposalMethod) {
      throw new DomainError("PROFILE_INVALID", "Eksik profil doğrulanamaz: başlangıç olayı, süre, birim ve imha yöntemi girilmelidir");
    }
    if (cur.disposalApproverIds.length < 2) {
      throw new DomainError("PROFILE_INVALID", "Ayrılık ilkesi için en az iki imha onaycısı tanımlanmalıdır");
    }
    const last = await tx.retentionRuleVersion.findFirst({ where: { profileId: cur.id }, orderBy: { version: "desc" } });
    if (!last) throw new DomainError("PROFILE_INVALID", "Profil sürümü yok");
    const upd = await tx.retentionProfile.updateMany({
      where: { id: cur.id, rowVersion: input.expectedRowVersion },
      data: { verifiedByLegal: true, rowVersion: { increment: 1 }, updatedBy: input.actor.userId },
    });
    if (upd.count !== 1) throw new DomainError("VERSION_CONFLICT");
    await tx.retentionRuleVersion.create({
      data: {
        profileId: cur.id, version: last.version + 1, snapshot: { ...(last.snapshot as Prisma.JsonObject), verifiedByLegal: true, verifiedById: input.actor.userId, verifiedAt: input.now.toISOString() },
        validFrom: cur.effectiveFrom, createdBy: input.actor.userId,
      },
    });
    await appendAudit(tx, {
      actorType: "USER", actorId: input.actor.userId, eventType: "RETENTION_PROFILE_LEGAL_VERIFIED", targetType: "RETENTION_PROFILE", targetId: cur.id,
      outcome: "SUCCESS", correlationId: input.correlationId, afterSummary: { version: last.version + 1, verifiedByLegal: true },
    });
    return { version: last.version + 1 };
  });
}

/**
 * Bir belgenin imha uygunluğunu VERİTABANI gerçeğinden hesaplar (tek kaynak). Hem inceleme kuyruğu,
 * hem karar, hem yürütücü aynı fonksiyonu kullanır. Engeller açıklanabilir döner.
 */
export async function computeDisposalEligibility(
  tx: Tx,
  input: { documentId: string; now: Date; fiscalYearEndByYear?: Readonly<Record<string, string>>; auditReady: boolean },
) {
  const doc = await tx.document.findUnique({
    where: { id: input.documentId },
    include: { retentionProfile: true, contract: true, versions: { include: { signatureEvidence: true } } },
  });
  if (!doc) throw new DomainError("NOT_FOUND");
  const today = istanbulDate(input.now);
  const p = doc.retentionProfile;
  const profile: RetentionProfileFacts | null = p
    ? {
        exists: p.isActive,
        verifiedByLegal: p.verifiedByLegal,
        startEvent: p.startEvent,
        durationValue: p.durationValue,
        durationUnit: p.durationUnit,
        disposalMethod: p.disposalMethod,
        disposalApproverCount: p.disposalApproverIds.length,
      }
    : null;

  const createdYear = istanbulDate(doc.createdAt).slice(0, 4);
  const fiscalYearEndDate = input.fiscalYearEndByYear?.[createdYear] ?? null;
  const lastTrigger = await tx.retentionTriggerEvent.findFirst({ where: { documentId: doc.id }, orderBy: { eventDate: "desc" } });
  const startDate = p?.startEvent
    ? resolveStartDate(p.startEvent, {
        documentCreatedDate: istanbulDate(doc.createdAt),
        contractEndDate: dateOnly(doc.contract?.endDate ?? null),
        fiscalYearEndDate,
        manualEventDate: dateOnly(lastTrigger?.eventDate ?? null),
      })
    : null;

  const legalHoldCount = await tx.legalHold.count({ where: { documentId: doc.id, releasedAt: null } });

  const contractStatus = doc.contract ? doc.contractStatus : null;
  const activeContractExists = !!doc.contract && !(CONTRACT_TERMINAL as readonly string[]).includes(String(contractStatus));
  let openObligationCount = 0;
  let openApprovalCount = 0;
  if (doc.contract) {
    openObligationCount = await tx.obligation.count({
      where: { contractId: doc.contract.id, status: { in: ["OPEN", "OVERDUE", "NEEDS_MANUAL_VERIFICATION"] } },
    });
    openApprovalCount = await tx.workflowInstance.count({
      where: { subjectType: "CONTRACT", subjectId: doc.contract.id, status: "ACTIVE" },
    });
  }

  const versionIds = doc.versions.map((v) => v.id);
  const fileObjectIds = doc.versions.map((v) => v.fileObjectId).filter((x): x is string => x !== null);
  const relatedOpen = await tx.documentRelation.count({
    where: {
      OR: [
        { fromDocumentId: doc.id, to: { generalStatus: { not: "DISPOSED" } } },
        { toDocumentId: doc.id, from: { generalStatus: { not: "DISPOSED" } } },
      ],
    },
  });
  const importRefs = fileObjectIds.length
    ? await tx.importBatch.count({ where: { fileObjectId: { in: fileObjectIds } } })
    : 0;
  const signatureEvidence = doc.versions.filter((v) => v.signatureEvidence !== null).length;
  // Sözleşme kayıtları ve imza kanıtları Faz 4'te imha kapsamı DIŞINDADIR: bağımlı kayıt sayılır (muhafazakâr).
  const contractDependent = doc.contract ? 1 : 0;
  const dependentRecordCount = relatedOpen + importRefs + signatureEvidence + contractDependent;

  const eligibility: DisposalEligibility = evaluateDisposalEligibility({
    profile,
    startDate,
    today,
    legalHoldActive: legalHoldCount > 0,
    activeContractExists,
    openObligationCount,
    dependentRecordCount,
    openApprovalCount,
    auditReady: input.auditReady,
  });

  return {
    eligibility,
    today,
    doc,
    profileId: p?.id ?? null,
    profileCode: p?.code ?? null,
    startEvent: p?.startEvent ?? null,
    startDate,
    versionIds,
    fileObjectIds,
    legalHoldCount,
    dependentRecordCount,
  };
}

/** Belgeye saklama profili atar (null = kaldır). Yetki: document.retention_review. Profil aktif ve doğrulanmış olmak ZORUNDA DEĞİL; eksiklik uyarı olarak görünür. */
export async function assignRetentionProfile(
  prisma: PrismaClient,
  input: { actor: ActorContext; now: Date; correlationId: string; documentId: string; profileId: string | null; expectedRowVersion: number },
): Promise<void> {
  await guardDocument(prisma, { actor: input.actor, now: input.now, documentId: input.documentId, permission: "document.retention_review" });
  await prisma.$transaction(async (tx) => {
    const doc = await tx.document.findUnique({ where: { id: input.documentId } });
    if (!doc) throw new DomainError("NOT_FOUND");
    if (doc.generalStatus === "DISPOSED") throw new DomainError("DOCUMENT_DISPOSED");
    if (doc.rowVersion !== input.expectedRowVersion) throw new DomainError("VERSION_CONFLICT");
    if (input.profileId) {
      const prof = await tx.retentionProfile.findUnique({ where: { id: input.profileId } });
      if (!prof || !prof.isActive) throw new DomainError("PROFILE_INVALID", "Profil bulunamadı veya pasif");
    }
    const upd = await tx.document.updateMany({
      where: { id: doc.id, rowVersion: input.expectedRowVersion },
      data: { retentionProfileId: input.profileId, rowVersion: { increment: 1 }, updatedBy: input.actor.userId },
    });
    if (upd.count !== 1) throw new DomainError("VERSION_CONFLICT");
    await appendAudit(tx, {
      actorType: "USER", actorId: input.actor.userId, eventType: "RETENTION_PROFILE_ASSIGNED", targetType: "DOCUMENT", targetId: doc.id,
      outcome: "SUCCESS", correlationId: input.correlationId,
      beforeSummary: { retentionProfileId: doc.retentionProfileId }, afterSummary: { retentionProfileId: input.profileId },
    });
  });
}

/** MANUAL_EVENT başlangıcı: belgeye tetikleyici olay eklenir (yalnız eklenir; silinmez). Yetki: document.retention_review. */
export async function recordRetentionTriggerEvent(
  prisma: PrismaClient,
  input: { actor: ActorContext; now: Date; correlationId: string; documentId: string; eventDate: string; note: string },
): Promise<{ eventId: string }> {
  await guardDocument(prisma, { actor: input.actor, now: input.now, documentId: input.documentId, permission: "document.retention_review" });
  if (!isCalendarDate(input.eventDate)) throw new DomainError("PROFILE_INVALID", "Olay tarihi geçersiz");
  if (!input.note.trim()) throw new DomainError("REASON_REQUIRED");
  const id = uuidv7();
  await prisma.$transaction(async (tx) => {
    const doc = await tx.document.findUnique({ where: { id: input.documentId }, select: { generalStatus: true } });
    if (doc?.generalStatus === "DISPOSED") throw new DomainError("DOCUMENT_DISPOSED");
    await tx.retentionTriggerEvent.create({
      data: { id, documentId: input.documentId, eventDate: new Date(`${input.eventDate}T00:00:00Z`), note: input.note.trim(), recordedById: input.actor.userId },
    });
    await appendAudit(tx, {
      actorType: "USER", actorId: input.actor.userId, eventType: "RETENTION_TRIGGER_RECORDED", targetType: "DOCUMENT", targetId: input.documentId,
      outcome: "SUCCESS", correlationId: input.correlationId, afterSummary: { eventId: id, eventDate: input.eventDate },
    });
  });
  return { eventId: id };
}

/**
 * Açıklanabilir saklama durumu: profil, sürüm, başlangıç olayı, tarih, vade ve engeller.
 * Belge görünür değilse NOT_FOUND. fiscalYearEndByYear: kurumun yıl→mali yıl sonu haritası (ör. {"2019": "2019-12-31"}); yoksa FISCAL_YEAR_END çözülmez.
 */
export async function getRetentionStatus(
  prisma: PrismaClient,
  input: { actor: ActorContext; now: Date; documentId: string; fiscalYearEndByYear?: Readonly<Record<string, string>> },
) {
  await guardDocument(prisma, { actor: input.actor, now: input.now, documentId: input.documentId, permission: "document.view_metadata" });
  const auditReady = (await verifyAuditTable(prisma)).ok;
  const fyMap = input.fiscalYearEndByYear ?? (await loadFiscalYearMap(prisma));
  return prisma.$transaction(async (tx) => {
    const r = await computeDisposalEligibility(tx, {
      documentId: input.documentId,
      now: input.now,
      auditReady,
      fiscalYearEndByYear: fyMap,
    });
    const profile = r.doc.retentionProfile;
    const policyGap = r.eligibility.blocks.some((b) => b === "NO_RETENTION_PROFILE" || b === "PROFILE_NOT_VERIFIED" || b === "PROFILE_INCOMPLETE");
    let latestVersion: { version: number; snapshot: Prisma.JsonValue } | null = null;
    if (profile) {
      latestVersion = await tx.retentionRuleVersion.findFirst({ where: { profileId: profile.id }, orderBy: { version: "desc" }, select: { version: true, snapshot: true } });
    }
    return {
      documentId: r.doc.id,
      profile: profile
        ? {
            id: profile.id,
            code: profile.code,
            verifiedByLegal: profile.verifiedByLegal,
            requiresLegalReview: profile.requiresLegalReview,
            disposalApproverCount: profile.disposalApproverIds.length,
            latestRuleVersion: latestVersion?.version ?? null,
          }
        : null,
      startEvent: r.startEvent,
      startDate: r.startDate,
      dueDate: r.eligibility.dueDate,
      today: r.today,
      eligible: r.eligibility.eligible,
      blocks: r.eligibility.blocks,
      /** "Politika eksiği": profil yok/doğrulanmamış/eksik → otomatik imha edilemez. */
      policyGap,
      legalHoldActive: r.legalHoldCount > 0,
      /** KVKK/sektörel yükümlülük işareti (arayüzde gösterilir). */
      legalReviewRequired: profile?.requiresLegalReview ?? false,
    };
  });
}

/** Saklama profilleri (yönetim ekranı). Yetki: config.manage veya contract.legal_review. */
export async function listRetentionProfiles(prisma: PrismaClient, input: { actor: ActorContext; now: Date }) {
  const ok = ["config.manage", "contract.legal_review"].some((p) => authorize({ actor: input.actor, permission: p, now: input.now }).allowed);
  if (!ok) throw new DomainError("FORBIDDEN", "Bu işlem için yetkiniz yok");
  const rows = await prisma.retentionProfile.findMany({ orderBy: { code: "asc" } });
  return rows.map((p) => ({
    id: p.id,
    code: p.code,
    rowVersion: p.rowVersion,
    verifiedByLegal: p.verifiedByLegal,
    requiresLegalReview: p.requiresLegalReview,
    startEvent: p.startEvent,
    durationValue: p.durationValue,
    durationUnit: p.durationUnit,
    disposalMethod: p.disposalMethod,
    disposalApproverCount: p.disposalApproverIds.length,
    basisNote: p.basisNote,
    isActive: p.isActive,
  }));
}
