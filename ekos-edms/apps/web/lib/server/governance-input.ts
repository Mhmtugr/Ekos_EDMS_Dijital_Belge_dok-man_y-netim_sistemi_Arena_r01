// Faz 4 istek gövdesi çözümleyicisi: alan tiplerini doğrular; kural doğrulaması servis katmanında yapılır.
import type { RetentionProfileInput } from "@ekos/db";

/** Saklama profili gövdesi. Zorunlu: code, effectiveFrom. Diğer alanlar servis tarafından doğrulanır. */
export function profileInput(b: Record<string, unknown>): RetentionProfileInput | null {
  const code = b.code;
  const effectiveFrom = b.effectiveFrom;
  if (typeof code !== "string" || typeof effectiveFrom !== "string") return null;
  const out: Record<string, unknown> = { code, effectiveFrom };
  for (const k of ["responsibleId", "basisNote", "startEvent", "reviewDueAt", "disposalMethod", "durationUnit"]) {
    if (k in b) out[k] = b[k] === null || typeof b[k] === "string" ? b[k] : undefined;
  }
  if ("durationValue" in b) out.durationValue = b.durationValue === null || typeof b.durationValue === "number" ? b.durationValue : undefined;
  if ("requiresLegalReview" in b) out.requiresLegalReview = b.requiresLegalReview === true;
  if ("disposalApproverIds" in b) {
    const v = b.disposalApproverIds;
    out.disposalApproverIds = Array.isArray(v) && v.every((x) => typeof x === "string") ? v : undefined;
  }
  return out as unknown as RetentionProfileInput;
}

export function isoDate(v: unknown): string | null {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

export function intOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) ? v : null;
}
