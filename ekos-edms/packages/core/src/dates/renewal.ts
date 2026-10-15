// Yenileme / ihbar tarihi hesabı (Faz 3, R-RNW-01).
// Kural: tarih YALNIZCA doğrulanmış (verifiedByLegal) bir kural ve geçerli bir bitiş tarihiyle hesaplanır.
// Aksi halde NEEDS_MANUAL_VERIFICATION döner. İş günü/tatil takvimi kodlanmamıştır; iş günü kuralı
// yalnızca takvim günü/ay olarak uygulanır ve hafta sonu/tatil kaydırması YAPILMAZ (belirsizlik elle doğrulanır).
import type { CalendarDate } from "./index.js";

export type RenewalResult = CalendarDate | "NEEDS_MANUAL_VERIFICATION";

export interface NoticeRule {
  readonly verified: boolean;
  readonly noticeValue: number | null;
  readonly noticeUnit: "CALENDAR_DAYS" | "CALENDAR_MONTHS" | null;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parse(d: string): { y: number; m: number; d: number } | null {
  const match = DATE_RE.exec(d);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(y, m - 1, day));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== day) return null;
  return { y, m, d: day };
}

function fmt(y: number, m: number, d: number): CalendarDate {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` as CalendarDate;
}

/**
 * İhbar son tarihi = bitiş tarihinden geriye doğru süre. Ay çıkarımında gün taşarsa ayın son gününe sabitlenir
 * (örn. 31 Mart − 1 ay = 28/29 Şubat).
 */
export function computeNoticeDeadline(endDate: string | null, rule: NoticeRule): RenewalResult {
  if (!rule.verified || rule.noticeValue === null || rule.noticeUnit === null) return "NEEDS_MANUAL_VERIFICATION";
  if (!Number.isInteger(rule.noticeValue) || rule.noticeValue < 0) return "NEEDS_MANUAL_VERIFICATION";
  const p = endDate ? parse(endDate) : null;
  if (!p) return "NEEDS_MANUAL_VERIFICATION";

  if (rule.noticeUnit === "CALENDAR_DAYS") {
    const t = Date.UTC(p.y, p.m - 1, p.d) - rule.noticeValue * 86_400_000;
    const dt = new Date(t);
    return fmt(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  // CALENDAR_MONTHS
  const totalMonths = p.y * 12 + (p.m - 1) - rule.noticeValue;
  const ty = Math.floor(totalMonths / 12);
  const tm = (totalMonths % 12) + 1;
  const lastDay = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  return fmt(ty, tm, Math.min(p.d, lastDay));
}

/** Yenileme tarihi: yalnızca AUTO_RENEW/MANUAL_RENEW kuralı doğrulanmışsa hesaplanır; NO_RENEW için tarih yoktur. */
export function computeRenewalReviewDate(
  endDate: string | null,
  basis: "AUTO_RENEW" | "MANUAL_RENEW" | "NO_RENEW" | null,
  rule: NoticeRule,
): RenewalResult | null {
  if (basis === "NO_RENEW") return null;
  return computeNoticeDeadline(endDate, rule);
}

export const RENEWAL_DATE_RULE_NOTE = "Doğrulanmamış hüküm: tarih üretilmez, NEEDS_MANUAL_VERIFICATION." as const;
