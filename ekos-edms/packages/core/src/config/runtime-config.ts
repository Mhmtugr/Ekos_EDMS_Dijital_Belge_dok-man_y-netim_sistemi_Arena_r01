// Üretim yapılandırma doğrulaması (Faz 7, madde 4). SAF fonksiyon: ortam değişkenlerini okur, sorunları listeler.
// Kural: ERROR varsa uygulama başlamayı reddeder; WARNING uygulamayı durdurmaz ama açıkça raporlanır.
// Değerler (secret) hata mesajlarına YAZILMAZ; yalnız anahtar adı ve kural kodu yazılır.

import { createHash } from "node:crypto";

export type RuntimeEnv = Readonly<Record<string, string | undefined>>;

export interface ConfigIssue {
  readonly severity: "ERROR" | "WARNING";
  readonly key: string;
  readonly code: string;
  readonly message: string;
}

export interface RuntimeLimits {
  readonly maxUploadBytes: number;
  readonly maxManifestBytes: number;
  readonly searchPageMax: number;
  readonly jobsIntervalSeconds: number;
  readonly esignTimeoutMs: number;
  readonly clamdTimeoutMs: number;
}

export interface RuntimeConfigReport {
  readonly ok: boolean;
  readonly issues: readonly ConfigIssue[];
  readonly limits: RuntimeLimits;
}

/** Bilinen geliştirme parolası (scripts/pg-dev, test harness). Üretimde DATABASE_URL içinde görülürse reddedilir. */
// Literaller birleştirilerek üretilir: üretim derlemesinde geliştirme parolası metni bulunmaz (sahte veri taraması bunu doğrular).
// Bilinen geliştirme parolalarının SHA-256 özetleri (metni değil): üretim bundle'ında parola literali bulunmaz.
const KNOWN_DEV_SECRET_SHA256: readonly string[] = [
  "1dd5d7bce0778b5d097c488bab71d3ab13a6a5db38d2f4cace18fd1bba66e0c1", // geliştirme veritabanı parolası (scripts/pg-dev, test harness)
  "46a1af4677c386d3a88a8eac49d72b1c43fc50ea6182ac027a98316027df6f2e",
];

/** DATABASE_URL içindeki parolanın bilinen geliştirme parolası olup olmadığını denetler (değer loglanmaz). */
function usesKnownDevSecret(dbUrl: string): boolean {
  let password: string;
  try {
    password = decodeURIComponent(new URL(dbUrl).password);
  } catch {
    return false;
  }
  if (password.length === 0) return false;
  const digest = createHash("sha256").update(password).digest("hex");
  return KNOWN_DEV_SECRET_SHA256.includes(digest);
}

const LIMIT_SPEC = {
  MAX_UPLOAD_MB: { def: 50, min: 1, max: 200 },
  MAX_MANIFEST_MB: { def: 5, min: 1, max: 50 },
  SEARCH_PAGE_MAX: { def: 100, min: 10, max: 500 },
  JOBS_INTERVAL_SECONDS: { def: 300, min: 30, max: 86_400 },
  ESIGN_TIMEOUT_MS: { def: 30_000, min: 1_000, max: 120_000 },
  CLAMD_TIMEOUT_MS: { def: 60_000, min: 1_000, max: 300_000 },
} as const;

type LimitKey = keyof typeof LIMIT_SPEC;

function present(v: string | undefined): v is string {
  return v !== undefined && v.trim().length > 0;
}

/** Tamsayı sınır değeri. Tanımsız → varsayılan; geçersiz → hata (sessiz düzeltme yok). */
function readLimit(env: RuntimeEnv, key: LimitKey, issues: ConfigIssue[]): number {
  const spec = LIMIT_SPEC[key];
  const raw = env[key];
  if (!present(raw)) return spec.def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < spec.min || n > spec.max) {
    issues.push({ severity: "ERROR", key, code: "LIMIT_OUT_OF_RANGE", message: `${key} ${String(spec.min)}..${String(spec.max)} aralığında tam sayı olmalı` });
    return spec.def;
  }
  return n;
}

function isHttps(url: string): boolean {
  return /^https:\/\/[^\s/]+/.test(url);
}

function isPostgresUrl(url: string): boolean {
  return /^postgres(ql)?:\/\/[^\s]+$/.test(url);
}

/** Base64 çözümü 32 bayt olmalı (AES-256 anahtarı). */
export function isValidTotpKey(raw: string): boolean {
  const buf = Buffer.from(raw, "base64");
  return buf.length === 32 && buf.toString("base64") === raw.replace(/\s+/g, "");
}

export function validateRuntimeConfig(env: RuntimeEnv, opts: { production: boolean }): RuntimeConfigReport {
  const issues: ConfigIssue[] = [];
  const prod = opts.production;
  const err = (key: string, code: string, message: string) => issues.push({ severity: "ERROR", key, code, message });
  const warn = (key: string, code: string, message: string) => issues.push({ severity: "WARNING", key, code, message });
  // Üretimde eksik zorunlu değer ERROR; geliştirmede WARNING (yerel kurulum kolaylığı).
  const required = (key: string, code: string, message: string) => {
    if (prod) err(key, code, message);
    else warn(key, code, message);
  };

  // --- Veritabanı ---
  const dbUrl = env.DATABASE_URL;
  if (!present(dbUrl)) required("DATABASE_URL", "REQUIRED_MISSING", "DATABASE_URL tanımlı değil");
  else {
    if (!isPostgresUrl(dbUrl)) err("DATABASE_URL", "INVALID_FORMAT", "DATABASE_URL postgres:// veya postgresql:// ile başlamalı");
    if (prod && usesKnownDevSecret(dbUrl)) err("DATABASE_URL", "KNOWN_DEV_SECRET", "Üretimde bilinen geliştirme parolası kullanılamaz");
  }

  // --- Nesne deposu (karantina + objects/) ---
  const storage = env.STORAGE_ROOT;
  if (!present(storage)) required("STORAGE_ROOT", "REQUIRED_MISSING", "STORAGE_ROOT tanımlı değil");
  else if (!storage.startsWith("/")) err("STORAGE_ROOT", "NOT_ABSOLUTE", "STORAGE_ROOT mutlak yol olmalı");

  // --- Kimlik doğrulama ---
  const mode = env.AUTH_MODE;
  if (mode !== "local" && mode !== "oidc") {
    if (prod || present(mode)) err("AUTH_MODE", "INVALID_OR_MISSING", "AUTH_MODE \"local\" veya \"oidc\" olarak açıkça seçilmeli (varsayılan yoktur)");
    else warn("AUTH_MODE", "INVALID_OR_MISSING", "AUTH_MODE seçilmemiş");
  }
  if (mode === "local") {
    const key = env.TOTP_ENCRYPTION_KEY;
    if (!present(key)) required("TOTP_ENCRYPTION_KEY", "REQUIRED_MISSING", "TOTP_ENCRYPTION_KEY tanımlı değil (TOTP kullanılamaz)");
    else if (!isValidTotpKey(key.trim())) err("TOTP_ENCRYPTION_KEY", "INVALID_FORMAT", "TOTP_ENCRYPTION_KEY 32 bayt base64 olmalı");
  }
  if (mode === "oidc") {
    for (const key of ["ENTRA_TENANT_ID", "ENTRA_CLIENT_ID", "ENTRA_CLIENT_SECRET", "ENTRA_REDIRECT_URI"] as const) {
      if (!present(env[key])) err(key, "REQUIRED_MISSING", `${key} OIDC modu için zorunlu`);
    }
    const redirect = env.ENTRA_REDIRECT_URI;
    if (present(redirect) && prod && !isHttps(redirect)) err("ENTRA_REDIRECT_URI", "NOT_HTTPS", "ENTRA_REDIRECT_URI üretimde https olmalı");
  }
  if (prod && env.EKOS_DEV_PASSWORD !== undefined) {
    err("EKOS_DEV_PASSWORD", "DEV_CREDENTIALS_IN_PRODUCTION", "Geliştirme kullanıcı parolası üretim ortamında tanımlanamaz");
  }

  // --- E-imza: kısmi yapılandırma yasak (ya tamamı ya hiçbiri) ---
  const esign = ["ESIGN_API_BASE_URL", "ESIGN_API_TOKEN", "ESIGN_WEBHOOK_SECRET"] as const;
  const esignSet = esign.filter((k) => present(env[k]));
  if (esignSet.length > 0 && esignSet.length < esign.length) {
    for (const k of esign) if (!present(env[k])) err(k, "PARTIAL_CONFIG", `${k} eksik: e-imza yapılandırması ya tamamı ya hiçbiri olmalı`);
  }
  if (present(env.ESIGN_API_BASE_URL) && !isHttps(env.ESIGN_API_BASE_URL)) err("ESIGN_API_BASE_URL", "NOT_HTTPS", "ESIGN_API_BASE_URL https olmalı");

  // --- Antivirüs: yoksa dosyalar karantinada kalır (kod düzeyinde güvenli); üretimde uyarı ---
  if (!present(env.CLAMD_HOST)) warn("CLAMD_HOST", "NOT_CONFIGURED", "Antivirüs (ClamAV) yapılandırılmadı: yüklenen dosyalar taranamaz ve kullanılamaz");

  // --- Yapay zekâ: varsayılan kapalı; açılması için kurum onayı ortam değişkenleriyle ---
  const provider = env.AI_PROVIDER;
  if (present(provider) && provider !== "gemini" && provider !== "vertex") err("AI_PROVIDER", "INVALID_VALUE", "AI_PROVIDER \"gemini\" veya \"vertex\" olmalı");
  const approved = env.AI_DATA_PROCESSING_APPROVED === "true";
  if (present(provider) && !approved) warn("AI_DATA_PROCESSING_APPROVED", "AI_DISABLED", "AI sağlayıcı tanımlı ama veri işleme onayı yok: AI kapalı");
  if (approved && present(provider)) {
    if (!present(env.AI_APPROVED_DOCUMENT_TYPES)) err("AI_APPROVED_DOCUMENT_TYPES", "REQUIRED_MISSING", "Onaylı belge türleri listesi boş: dış AI'ya hiçbir belge gönderilmez");
    if (provider === "gemini" && !present(env.GEMINI_API_KEY)) err("GEMINI_API_KEY", "REQUIRED_MISSING", "Gemini için GEMINI_API_KEY zorunlu");
    if (provider === "vertex") {
      for (const k of ["VERTEX_PROJECT", "VERTEX_LOCATION", "VERTEX_ACCESS_TOKEN"] as const) {
        if (!present(env[k])) err(k, "REQUIRED_MISSING", `${k} Vertex AI için zorunlu`);
      }
    }
  }

  // --- Limitler ---
  const limits: RuntimeLimits = {
    maxUploadBytes: readLimit(env, "MAX_UPLOAD_MB", issues) * 1024 * 1024,
    maxManifestBytes: readLimit(env, "MAX_MANIFEST_MB", issues) * 1024 * 1024,
    searchPageMax: readLimit(env, "SEARCH_PAGE_MAX", issues),
    jobsIntervalSeconds: readLimit(env, "JOBS_INTERVAL_SECONDS", issues),
    esignTimeoutMs: readLimit(env, "ESIGN_TIMEOUT_MS", issues),
    clamdTimeoutMs: readLimit(env, "CLAMD_TIMEOUT_MS", issues),
  };

  return { ok: !issues.some((i) => i.severity === "ERROR"), issues, limits };
}
