// IP bazlı hız sınırı (sabit pencere). Tek süreçli dağıtım için bellek içi; çok süreçli dağıtımda
// paylaşımlı depo gerekir (belgelenmiş sınır). Hesap bazlı kilitleme ayrıca veritabanındadır.
export interface RateLimitPolicy {
  readonly max: number;
  readonly windowMs: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** İstek IP'si. Ters vekil arkasında ilk X-Forwarded-For girdisi kullanılır. */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Denemeyi sayar. Limit aşıldıysa false döner. */
export function consumeRateLimit(key: string, policy: RateLimitPolicy, now: number = Date.now()): boolean {
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + policy.windowMs });
    return true;
  }
  current.count += 1;
  return current.count <= policy.max;
}

/** Test ve bakım için. */
export function resetRateLimits(): void {
  buckets.clear();
}
