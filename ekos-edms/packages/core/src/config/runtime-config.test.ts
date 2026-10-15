// Faz 7 madde 4: üretim yapılandırma doğrulaması birim testleri.
import { describe, expect, it } from "vitest";
import { isValidTotpKey, validateRuntimeConfig, type RuntimeEnv } from "./runtime-config.js";

const KEY32 = Buffer.alloc(32, 7).toString("base64");
const GOOD_PROD: RuntimeEnv = {
  DATABASE_URL: "postgresql://ekos_app:Gercek-Gizli-Parola-9@db.ic.local:5432/ekos",
  STORAGE_ROOT: "/var/lib/ekos/storage",
  AUTH_MODE: "local",
  TOTP_ENCRYPTION_KEY: KEY32,
  CLAMD_HOST: "clamav",
};
const errorKeys = (env: RuntimeEnv, production: boolean) =>
  validateRuntimeConfig(env, { production }).issues.filter((i) => i.severity === "ERROR").map((i) => i.key);

describe("validateRuntimeConfig", () => {
  it("geçerli üretim yapılandırmasını kabul eder ve varsayılan limitleri döndürür", () => {
    const r = validateRuntimeConfig(GOOD_PROD, { production: true });
    expect(r.ok).toBe(true);
    expect(r.limits.maxUploadBytes).toBe(50 * 1024 * 1024);
    expect(r.limits.esignTimeoutMs).toBe(30_000);
  });

  it("üretimde DATABASE_URL yoksa ERROR (başlatma reddedilir)", () => {
    const rest: RuntimeEnv = { ...GOOD_PROD, DATABASE_URL: undefined };
    expect(errorKeys(rest, true)).toContain("DATABASE_URL");
  });

  it("geliştirmede eksik zorunlu değer yalnız WARNING'dir", () => {
    const r = validateRuntimeConfig({ AUTH_MODE: "local" }, { production: false });
    expect(r.ok).toBe(true);
    expect(r.issues.some((i) => i.key === "DATABASE_URL" && i.severity === "WARNING")).toBe(true);
  });

  it("üretimde bilinen geliştirme parolası reddedilir", () => {
    expect(errorKeys({ ...GOOD_PROD, DATABASE_URL: "postgresql://u:ekos-test-only@h/db" }, true)).toContain("DATABASE_URL");
  });

  it("göreli STORAGE_ROOT reddedilir", () => {
    expect(errorKeys({ ...GOOD_PROD, STORAGE_ROOT: "storage" }, true)).toContain("STORAGE_ROOT");
  });

  it("AUTH_MODE varsayılan olarak seçilmez: üretimde ERROR", () => {
    const rest: RuntimeEnv = { ...GOOD_PROD, AUTH_MODE: undefined };
    expect(errorKeys(rest, true)).toContain("AUTH_MODE");
  });

  it("TOTP anahtarı 32 bayt base64 değilse reddedilir", () => {
    expect(errorKeys({ ...GOOD_PROD, TOTP_ENCRYPTION_KEY: "kisa" }, true)).toContain("TOTP_ENCRYPTION_KEY");
    expect(isValidTotpKey(KEY32)).toBe(true);
  });

  it("OIDC modunda Entra alanları zorunludur ve üretimde redirect https olmalı", () => {
    const env: RuntimeEnv = { ...GOOD_PROD, AUTH_MODE: "oidc", TOTP_ENCRYPTION_KEY: undefined, ENTRA_REDIRECT_URI: "http://x/cb" };
    const keys = errorKeys(env, true);
    expect(keys).toEqual(expect.arrayContaining(["ENTRA_TENANT_ID", "ENTRA_CLIENT_ID", "ENTRA_CLIENT_SECRET", "ENTRA_REDIRECT_URI"]));
  });

  it("üretimde geliştirme parolası tanımlıysa ERROR", () => {
    expect(errorKeys({ ...GOOD_PROD, EKOS_DEV_PASSWORD: "x" }, true)).toContain("EKOS_DEV_PASSWORD");
  });

  it("e-imza yapılandırması kısmi olamaz ve https zorunludur", () => {
    expect(errorKeys({ ...GOOD_PROD, ESIGN_API_BASE_URL: "https://e.example" }, true)).toContain("ESIGN_API_TOKEN");
    expect(errorKeys({ ...GOOD_PROD, ESIGN_API_BASE_URL: "http://e.example", ESIGN_API_TOKEN: "t", ESIGN_WEBHOOK_SECRET: "s" }, true)).toContain("ESIGN_API_BASE_URL");
  });

  it("limitler yapılandırılabilir; aralık dışı değer ERROR (sessiz düzeltme yok)", () => {
    const ok = validateRuntimeConfig({ ...GOOD_PROD, MAX_UPLOAD_MB: "120", ESIGN_TIMEOUT_MS: "5000" }, { production: true });
    expect(ok.ok).toBe(true);
    expect(ok.limits.maxUploadBytes).toBe(120 * 1024 * 1024);
    expect(ok.limits.esignTimeoutMs).toBe(5000);
    expect(errorKeys({ ...GOOD_PROD, MAX_UPLOAD_MB: "100000" }, true)).toContain("MAX_UPLOAD_MB");
    expect(errorKeys({ ...GOOD_PROD, SEARCH_PAGE_MAX: "abc" }, true)).toContain("SEARCH_PAGE_MAX");
  });

  it("hata mesajları gizli değerleri (parola, anahtar) içermez", () => {
    const secret = "Gercek-Gizli-Parola-9";
    const r = validateRuntimeConfig({ ...GOOD_PROD, DATABASE_URL: `http://${secret}`, TOTP_ENCRYPTION_KEY: "gizli-kisa" }, { production: true });
    const text = JSON.stringify(r.issues);
    expect(text).not.toContain(secret);
    expect(text).not.toContain("gizli-kisa");
  });

  it("antivirüs yapılandırılmamışsa uyarı verilir (dosyalar karantinada kalır)", () => {
    const r = validateRuntimeConfig({ ...GOOD_PROD, CLAMD_HOST: undefined }, { production: true });
    expect(r.issues.some((i) => i.key === "CLAMD_HOST" && i.severity === "WARNING")).toBe(true);
  });
});
