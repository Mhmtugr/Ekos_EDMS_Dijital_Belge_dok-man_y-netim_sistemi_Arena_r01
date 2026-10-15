// Yapılandırılabilir limitler (Faz 7, madde 4). Değerler ortam değişkenlerinden okunur; geçersiz değer varsayılana
// düşmez: doğrulama hataları başlatmayı zaten reddeder (instrumentation.ts). Her çağrıda hesaplanır (ucuz, saf).
import { validateRuntimeConfig, type RuntimeLimits } from "@ekos/core";

export function limits(): RuntimeLimits {
  return validateRuntimeConfig(process.env, { production: process.env.NODE_ENV === "production" }).limits;
}
