// Yeniden deneme politikası (db tarafı; kaynak: adapters/integrations/retry.ts). Saf fonksiyonlar.
export interface BackoffPolicy {
  readonly baseMs: number;
  readonly maxMs: number;
  readonly maxAttempts: number;
}

export const DEFAULT_BACKOFF: BackoffPolicy = { baseMs: 30_000, maxMs: 6 * 60 * 60 * 1000, maxAttempts: 8 };

export function nextDelayMs(policy: BackoffPolicy, attempt: number, jitter01 = 0.5): number {
  const exp = Math.min(policy.maxMs, policy.baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(exp * (0.5 + 0.5 * Math.min(1, Math.max(0, jitter01))));
}

export function shouldRetry(policy: BackoffPolicy, attempt: number, retryable: boolean): boolean {
  return retryable && attempt < policy.maxAttempts;
}
