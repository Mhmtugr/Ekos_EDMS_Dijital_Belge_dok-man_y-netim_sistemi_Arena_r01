// Çıkarım sonuçlarının kayıt, doğrulama ve sözleşme alanına uygulanması (Faz 6 madde 3 ve 5).
// Kural: kritik alan VERIFIED olmadan sözleşme alanına yazılmaz ve alarm üretmez; SUGGESTED kritik alanlar sessiz beklemededir.
import { Prisma, type PrismaClient } from "@prisma/client";
import { CRITICAL_FIELD_KEYS, type ActorContext, type ExtractionCandidate } from "@ekos/core";
import { DomainError } from "../documents/shared.js";
import { documentVisibilitySql } from "../documents/visibility.js";
import { appendAudit } from "../audit.js";
import { updateContractFields, type ContractFieldsInput } from "../contracts/lifecycle.js";

const EDIT_PERMISSION = "document.edit_metadata";

function hasActiveEditGrant(actor: ActorContext, now: Date): boolean {
  return actor.memberships.some(
    (m) =>
      m.revokedAt == null &&
      (m.validFrom == null || m.validFrom.getTime() <= now.getTime()) &&
      (m.validUntil == null || m.validUntil.getTime() > now.getTime()) &&
      m.permissions.includes(EDIT_PERMISSION),
  );
}

/** Önceki bekleyen (SUGGESTED) öneriler yenilenir; doğrulanmış/reddedilmiş kayıtlar korunur. */
export async function saveExtractionCandidates(
  prisma: PrismaClient,
  input: {
    readonly documentId: string;
    readonly providerKey: string;
    readonly accepted: readonly ExtractionCandidate[];
    readonly rejectedCount: number;
    readonly correlationId: string;
    readonly actorId: string | null;
  },
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    await tx.extractionResult.deleteMany({
      where: { documentId: input.documentId, providerKey: input.providerKey, validation: "SUGGESTED" },
    });
    if (input.accepted.length > 0) {
      await tx.extractionResult.createMany({
        data: input.accepted.map((c) => ({
          documentId: input.documentId,
          fieldKey: c.fieldKey,
          value: c.value,
          sourcePage: c.page,
          textStart: c.textStart,
          textEnd: c.textEnd,
          confidence: new Prisma.Decimal(c.confidence.toFixed(4)),
          validation: "SUGGESTED" as const,
          providerKey: input.providerKey,
        })),
      });
    }
    await appendAudit(tx, {
      actorType: "SYSTEM",
      actorId: input.actorId,
      eventType: "ai.extraction_saved",
      targetType: "Document",
      targetId: input.documentId,
      outcome: "SUCCESS",
      correlationId: input.correlationId,
      afterSummary: { providerKey: input.providerKey, accepted: input.accepted.length, rejected: input.rejectedCount },
    });
    return input.accepted.length;
  });
}

/** İnsan doğrulaması: belge aktör için görünür olmalı ve aktörde düzenleme yetkisi bulunmalı. */
export async function decideExtraction(
  prisma: PrismaClient,
  input: { readonly actor: ActorContext; readonly resultId: string; readonly decision: "VERIFIED" | "REJECTED"; readonly correlationId: string; readonly now?: Date },
): Promise<void> {
  const now = input.now ?? new Date();
  const row = await prisma.extractionResult.findUnique({
    where: { id: input.resultId },
    select: { id: true, documentId: true, fieldKey: true, validation: true },
  });
  // Görünmeyen belgeye ait kayıt ile "yok" aynı yanıtı verir (varlık sızıntısı yok).
  if (!row) throw new DomainError("NOT_FOUND", "Kayıt bulunamadı");
  const visible = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT d.id FROM "Document" d WHERE d.id = ${row.documentId}::uuid AND ${documentVisibilitySql(input.actor, now)}`);
  if (visible.length === 0) throw new DomainError("NOT_FOUND", "Kayıt bulunamadı");
  if (!hasActiveEditGrant(input.actor, now)) throw new DomainError("FORBIDDEN", "Doğrulama yetkiniz yok");
  if (row.validation !== "SUGGESTED") throw new DomainError("TRANSITION_DENIED", "Kayıt zaten karara bağlanmış");

  await prisma.$transaction(async (tx) => {
    const moved = await tx.extractionResult.updateMany({
      where: { id: row.id, validation: "SUGGESTED" },
      data: { validation: input.decision, verifiedById: input.actor.userId, verifiedAt: now },
    });
    if (moved.count !== 1) throw new DomainError("TRANSITION_DENIED", "Kayıt zaten karara bağlanmış");
    await appendAudit(tx, {
      actorType: "USER",
      actorId: input.actor.userId,
      eventType: input.decision === "VERIFIED" ? "ai.extraction_verified" : "ai.extraction_rejected",
      targetType: "ExtractionResult",
      targetId: row.id,
      outcome: "SUCCESS",
      correlationId: input.correlationId,
      afterSummary: { fieldKey: row.fieldKey, critical: CRITICAL_FIELD_KEYS.has(row.fieldKey as never) },
    });
  });
}

const CONTRACT_FIELD_OF: Partial<Record<string, keyof ContractFieldsInput>> = {
  effective_date: "effectiveDate",
  start_date: "startDate",
  end_date: "endDate",
  amount: "amount",
  currency: "currency",
  auto_renewal: "autoRenewal",
  payment_terms: "paymentTerms",
  notice_period_value: "noticePeriodValue",
  notice_period_unit: "noticePeriodUnit",
};

export interface ApplyResult {
  readonly appliedKeys: readonly string[];
  /** Yalnız VERIFIED kritik alanlardan, sözleşmedeki mevcut değerden farklı olanlar. */
  readonly alarms: readonly { readonly fieldKey: string; readonly verifiedValue: string; readonly currentValue: string | null }[];
  /** Doğrulanmamış kritik alan sayısı: yazılmaz ve alarm üretilmez (yalnız sayı raporlanır). */
  readonly pendingCriticalCount: number;
}

function toInput(key: string, value: string): Partial<ContractFieldsInput> | null {
  const f = CONTRACT_FIELD_OF[key];
  if (!f) return null;
  if (f === "autoRenewal") return { autoRenewal: value === "true" };
  if (f === "noticePeriodValue") return { noticePeriodValue: Number(value) };
  return { [f]: value };
}

/** Yalnız VERIFIED sonuçları sözleşme kaydına yazar (updateContractFields: iyimser kilit + denetim). */
export async function applyVerifiedExtractions(
  prisma: PrismaClient,
  input: { readonly actor: ActorContext; readonly documentId: string; readonly correlationId: string; readonly now?: Date },
): Promise<ApplyResult> {
  const now = input.now ?? new Date();
  const contract = await prisma.contractRecord.findUnique({
    where: { documentId: input.documentId },
    select: { id: true, rowVersion: true, effectiveDate: true, startDate: true, endDate: true, amount: true, currency: true, autoRenewal: true },
  });
  if (!contract) throw new DomainError("NOT_FOUND", "Sözleşme kaydı bulunamadı");
  if (!hasActiveEditGrant(input.actor, now)) throw new DomainError("FORBIDDEN", "Düzenleme yetkiniz yok");

  const rows = await prisma.extractionResult.findMany({
    where: { documentId: input.documentId, validation: { in: ["VERIFIED", "SUGGESTED"] } },
    orderBy: { createdAt: "desc" },
  });
  const verified = new Map<string, (typeof rows)[number]>();
  let pendingCriticalCount = 0;
  for (const r of rows) {
    if (r.validation === "SUGGESTED") {
      if (CRITICAL_FIELD_KEYS.has(r.fieldKey as never)) pendingCriticalCount += 1;
      continue;
    }
    if (!verified.has(r.fieldKey) && r.value !== null) verified.set(r.fieldKey, r);
  }

  const alarms: ApplyResult["alarms"][number][] = [];
  type MutableFields = { -readonly [K in keyof ContractFieldsInput]?: ContractFieldsInput[K] };
  const fields: MutableFields = {};
  const appliedKeys: string[] = [];
  const currentOf = (k: string): string | null => {
    switch (k) {
      case "effective_date": return contract.effectiveDate ? contract.effectiveDate.toISOString().slice(0, 10) : null;
      case "start_date": return contract.startDate ? contract.startDate.toISOString().slice(0, 10) : null;
      case "end_date": return contract.endDate ? contract.endDate.toISOString().slice(0, 10) : null;
      case "amount": return contract.amount?.toString() ?? null;
      case "currency": return contract.currency ?? null;
      case "auto_renewal": return contract.autoRenewal === null ? null : String(contract.autoRenewal);
      default: return null;
    }
  };
  for (const [key, row] of verified) {
    const value = row.value as string;
    const part = toInput(key, value);
    if (!part) continue;
    if (CRITICAL_FIELD_KEYS.has(key as never) && currentOf(key) !== null && currentOf(key) !== value) {
      alarms.push({ fieldKey: key, verifiedValue: value, currentValue: currentOf(key) });
    }
    Object.assign(fields, part);
    appliedKeys.push(key);
  }
  // Tutar ve para birimi birlikte yazılır (sözleşme servisinin kuralı). Para birimi bu çıkarımda yoksa
  // mevcut sözleşme para birimi kullanılır; o da yoksa tutar yazılmaz (sessizce atlanır, alarm üretilmez).
  if (fields.amount !== undefined && fields.currency === undefined) {
    if (contract.currency) {
      fields.currency = contract.currency;
    } else {
      delete fields.amount;
      const i = appliedKeys.indexOf("amount");
      if (i >= 0) appliedKeys.splice(i, 1);
    }
  }
  if (appliedKeys.length > 0) {
    await updateContractFields(prisma, {
      actor: { userId: input.actor.userId },
      correlationId: input.correlationId,
      contractId: contract.id,
      expectedRowVersion: contract.rowVersion,
      fields,
    });
  }
  return { appliedKeys, alarms, pendingCriticalCount };
}
