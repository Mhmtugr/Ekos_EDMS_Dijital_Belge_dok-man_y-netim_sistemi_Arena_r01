// Faz 4 saf kuralları: saklama süresi, imha kapısı, ayrılık ilkesi, kırılma-cam süresi, ayrılış tamamlama.
// I/O yoktur. Evrensel varsayılan süre KODLANMAZ (A5/2): süre yalnızca profilde kurum tarafından girilir.
// Tarihler yalnızca takvim günüdür (YYYY-MM-DD); saat dilimi kayması yoktur.

export type RetentionUnit = "CALENDAR_DAYS" | "CALENDAR_MONTHS" | "CALENDAR_YEARS";
export type RetentionStartEventKind = "DOCUMENT_CREATED" | "CONTRACT_END" | "FISCAL_YEAR_END" | "MANUAL_EVENT";
export type DisposalMethodKind = "DIGITAL_DELETE" | "PHYSICAL_DESTRUCTION_RECORD";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isCalendarDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

function fmt(y: number, m0: number, d: number): string {
  const probe = new Date(Date.UTC(y, m0, 1));
  const lastDay = new Date(Date.UTC(probe.getUTCFullYear(), probe.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  const mm = new Date(Date.UTC(y, m0, day));
  return `${String(mm.getUTCFullYear()).padStart(4, "0")}-${String(mm.getUTCMonth() + 1).padStart(2, "0")}-${String(mm.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Başlangıç tarihine takvim süresi ekler. Ay/yıl eklemede gün, hedef ayın son gününe sabitlenir
 * (31 Ocak + 1 ay = 28/29 Şubat). Gün eklemede düz takvim günü. Hafta sonu/tatil kaydırması YOKTUR.
 */
export function addCalendarDuration(startDate: string, value: number, unit: RetentionUnit): string {
  if (!isCalendarDate(startDate)) throw new Error("Geçersiz başlangıç tarihi");
  if (!Number.isInteger(value) || value < 0) throw new Error("Süre tam sayı ve sıfır veya pozitif olmalı");
  const [y, m, d] = startDate.split("-").map(Number) as [number, number, number];
  if (unit === "CALENDAR_DAYS") {
    const base = Date.UTC(y, m - 1, d) + value * 86_400_000;
    const dt = new Date(base);
    return fmt(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
  }
  const months = unit === "CALENDAR_YEARS" ? value * 12 : value;
  const total = (y * 12 + (m - 1)) + months;
  const ty = Math.floor(total / 12);
  const tm = total - ty * 12;
  return fmt(ty, tm, d);
}

export interface RetentionProfileFacts {
  readonly exists: boolean;
  readonly verifiedByLegal: boolean;
  readonly startEvent: RetentionStartEventKind | null;
  readonly durationValue: number | null;
  readonly durationUnit: RetentionUnit | null;
  readonly disposalMethod: DisposalMethodKind | null;
  /** İmha onaycı sayısı. İki kişiden azsa ayrılık ilkesi uygulanamaz → PROFILE_INCOMPLETE. */
  readonly disposalApproverCount: number;
}

/** Profilin tanımlı ve tam olduğunu denetler. Süre sınırsız ise durationValue null kalır → imha asla yapılmaz (güvenli varsayılan). */
export function profileDefinitionBlocks(p: RetentionProfileFacts | null): DisposalBlock[] {
  if (!p || !p.exists) return ["NO_RETENTION_PROFILE"];
  const out: DisposalBlock[] = [];
  if (!p.verifiedByLegal) out.push("PROFILE_NOT_VERIFIED");
  if (!p.startEvent || p.durationValue === null || !p.durationUnit || !p.disposalMethod) out.push("PROFILE_INCOMPLETE");
  else if (p.disposalApproverCount < 2) out.push("PROFILE_INCOMPLETE");
  return out;
}

export interface StartDateSources {
  /** DOCUMENT_CREATED: belge oluşturma tarihi (takvim günü). */
  readonly documentCreatedDate: string | null;
  /** CONTRACT_END: sözleşme bitiş tarihi. */
  readonly contractEndDate: string | null;
  /** FISCAL_YEAR_END: kurumun mali yıl sonu (kurum tarafından girilir; yoksa çözülemez). */
  readonly fiscalYearEndDate: string | null;
  /** MANUAL_EVENT: belgeye kaydedilmiş en son tetikleyici olay tarihi. */
  readonly manualEventDate: string | null;
}

export function resolveStartDate(event: RetentionStartEventKind, src: StartDateSources): string | null {
  const pick = (v: string | null): string | null => (v && isCalendarDate(v) ? v : null);
  switch (event) {
    case "DOCUMENT_CREATED":
      return pick(src.documentCreatedDate);
    case "CONTRACT_END":
      return pick(src.contractEndDate);
    case "FISCAL_YEAR_END":
      return pick(src.fiscalYearEndDate);
    case "MANUAL_EVENT":
      return pick(src.manualEventDate);
  }
}

export type DisposalBlock =
  | "NO_RETENTION_PROFILE"
  | "PROFILE_NOT_VERIFIED"
  | "PROFILE_INCOMPLETE"
  | "START_EVENT_UNRESOLVED"
  | "RETENTION_NOT_EXPIRED"
  | "LEGAL_HOLD_ACTIVE"
  | "ACTIVE_CONTRACT"
  | "OPEN_OBLIGATION"
  | "DEPENDENT_RECORD"
  | "OPEN_APPROVAL"
  | "AUDIT_INCOMPLETE";

export interface DisposalEligibilityInput {
  readonly profile: RetentionProfileFacts | null;
  /** Çözülmüş başlangıç tarihi; yoksa null (START_EVENT_UNRESOLVED). */
  readonly startDate: string | null;
  readonly today: string;
  readonly legalHoldActive: boolean;
  readonly activeContractExists: boolean;
  readonly openObligationCount: number;
  readonly dependentRecordCount: number;
  readonly openApprovalCount: number;
  /** Denetim izi sağlıklı mı (zincir doğrulandı mı). */
  readonly auditReady: boolean;
}

export interface DisposalEligibility {
  readonly eligible: boolean;
  readonly dueDate: string | null;
  readonly blocks: readonly DisposalBlock[];
}

/**
 * İmha uygunluğu. Tüm engeller döner (denetim için); eksik tek bir koşul bile uygunluğu kapatır.
 * `eligible=true` yalnızca İNCELEME kuyruğuna girme anlamına gelir; imha için insan onayları gerekir.
 */
export function evaluateDisposalEligibility(input: DisposalEligibilityInput): DisposalEligibility {
  const blocks: DisposalBlock[] = [...profileDefinitionBlocks(input.profile)];
  let dueDate: string | null = null;

  if (input.profile && input.profile.exists && input.profile.startEvent && input.profile.durationValue !== null && input.profile.durationUnit) {
    if (!input.startDate) {
      blocks.push("START_EVENT_UNRESOLVED");
    } else {
      dueDate = addCalendarDuration(input.startDate, input.profile.durationValue, input.profile.durationUnit);
      if (input.today < dueDate) blocks.push("RETENTION_NOT_EXPIRED");
    }
  }
  if (input.legalHoldActive) blocks.push("LEGAL_HOLD_ACTIVE");
  if (input.activeContractExists) blocks.push("ACTIVE_CONTRACT");
  if (input.openObligationCount > 0) blocks.push("OPEN_OBLIGATION");
  if (input.dependentRecordCount > 0) blocks.push("DEPENDENT_RECORD");
  if (input.openApprovalCount > 0) blocks.push("OPEN_APPROVAL");
  if (!input.auditReady) blocks.push("AUDIT_INCOMPLETE");

  const unique = [...new Set(blocks)];
  return { eligible: unique.length === 0, dueDate, blocks: unique };
}

export type ApproverViolation = "REVIEWER_MISSING" | "SECOND_APPROVER_MISSING" | "SAME_PERSON";

/** Ayrılık ilkesi: inceleyen ve ikinci onaycı iki FARKLI kişi olmalı. */
export function checkDisposalApprovers(input: { reviewerId: string | null; secondApproverId: string | null }): ApproverViolation[] {
  const v: ApproverViolation[] = [];
  if (!input.reviewerId) v.push("REVIEWER_MISSING");
  if (!input.secondApproverId) v.push("SECOND_APPROVER_MISSING");
  if (input.reviewerId && input.secondApproverId && input.reviewerId === input.secondApproverId) v.push("SAME_PERSON");
  return v;
}

/** Kırılma-cam süre sınırı (dakika). Yapılandırılabilir üst sınır; burada yalnızca güvenli varsayılan aralık tanımlanır. */
export const BREAK_GLASS_LIMITS = { minMinutes: 15, maxMinutes: 240 } as const;

export function validateBreakGlassDuration(minutes: number): "OK" | "DURATION_OUT_OF_RANGE" {
  if (!Number.isInteger(minutes)) return "DURATION_OUT_OF_RANGE";
  return minutes >= BREAK_GLASS_LIMITS.minMinutes && minutes <= BREAK_GLASS_LIMITS.maxMinutes ? "OK" : "DURATION_OUT_OF_RANGE";
}

export interface OffboardingItemFacts {
  readonly status: "OPEN" | "TRANSFERRED" | "WAIVED";
}

/**
 * Ayrılış tamamlanabilirliği. blockOnUnresolved=true: açık kalem varsa ENGEL (ok=false).
 * blockOnUnresolved=false: tamamlanır ama açık kalemler UYARI olarak döner (warning=true).
 */
export function canCompleteOffboarding(input: { blockOnUnresolved: boolean; items: readonly OffboardingItemFacts[] }): {
  ok: boolean;
  openCount: number;
  warning: boolean;
} {
  const openCount = input.items.filter((i) => i.status === "OPEN").length;
  if (input.blockOnUnresolved && openCount > 0) return { ok: false, openCount, warning: false };
  return { ok: true, openCount, warning: openCount > 0 };
}
