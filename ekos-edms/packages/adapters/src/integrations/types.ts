// Entegrasyon çerçevesi (Faz 6, madde 1). Durumlar A4/Faz 6 ile birebir.
export type IntegrationStatus = "NOT_CONFIGURED" | "CONFIGURED_UNVERIFIED" | "CONNECTED" | "FAILED";

export type Env = Readonly<Record<string, string | undefined>>;

/** Dış sistem hata kodu. Metin sanitize edilir: URL, token, parola, ham yanıt gövdesi taşımaz. */
export class IntegrationError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  constructor(code: string, retryable: boolean, message?: string) {
    super(message ?? code);
    this.name = "IntegrationError";
    this.code = code;
    this.retryable = retryable;
  }
}

/** Ortam değişkeni bir "secretRef" adına göre okunur; değer hiçbir yerde saklanmaz/loglanmaz. */
export function readEnv(env: Env, name: string): string | null {
  const v = env[name];
  return v === undefined || v.trim() === "" ? null : v.trim();
}

/** Bir entegrasyonun yapılandırılmış sayılması için gereken ortam değişkenlerinin tamamı dolu olmalı. */
export function allConfigured(env: Env, names: readonly string[]): boolean {
  return names.every((n) => readEnv(env, n) !== null);
}

export interface IntegrationDescriptor {
  readonly key: string;
  readonly displayName: string;
  readonly requiredEnv: readonly string[];
  /** Kurulumda gerekli, eksikse sistem sağlığında uyarı. */
  readonly critical: boolean;
}

/**
 * Durum çözümü: yapılandırma eksikse NOT_CONFIGURED; tamamsa son doğrulama sonucuna göre
 * CONNECTED/FAILED; hiç doğrulanmamışsa CONFIGURED_UNVERIFIED. "Yapılandırıldı" ≠ "Bağlı".
 */
export function resolveStatus(configured: boolean, lastProbe: "OK" | "FAILED" | null): IntegrationStatus {
  if (!configured) return "NOT_CONFIGURED";
  if (lastProbe === null) return "CONFIGURED_UNVERIFIED";
  return lastProbe === "OK" ? "CONNECTED" : "FAILED";
}
