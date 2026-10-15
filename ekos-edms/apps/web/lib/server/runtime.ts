// Çalışma zamanı yapılandırması. Eksik ortam değişkeni AÇIK hata verir; sessiz varsayılan yoktur (A5/4).
import { ClamdAntivirus, FsObjectStorage } from "@ekos/adapters";
import { createPrisma, parseTotpKey, type PrismaClient } from "@ekos/db";
import type { AntivirusPort, ObjectStoragePort } from "@ekos/core";
import { limits } from "./limits";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

let prismaSingleton: PrismaClient | undefined;

export function db(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url || url.trim() === "") throw new ConfigError("DATABASE_URL tanımlı değil");
  prismaSingleton ??= createPrisma(url);
  return prismaSingleton;
}

export function storage(): ObjectStoragePort {
  const root = process.env.STORAGE_ROOT;
  if (!root || root.trim() === "") throw new ConfigError("STORAGE_ROOT tanımlı değil");
  return new FsObjectStorage(root);
}

/** ClamAV yapılandırılmamışsa null: tarama YAPILMAZ ve bu "Tarandı" diye gösterilmez. */
export function antivirus(): AntivirusPort | null {
  const host = process.env.CLAMD_HOST;
  if (!host || host.trim() === "") return null;
  const port = Number(process.env.CLAMD_PORT ?? "3310");
  if (!Number.isInteger(port) || port <= 0) throw new ConfigError("CLAMD_PORT geçersiz");
  return new ClamdAntivirus({ host, port, timeoutMs: limits().clamdTimeoutMs });
}

export type AuthMode = "local" | "oidc" | "unset";

export function authMode(): AuthMode {
  const m = process.env.AUTH_MODE;
  return m === "local" || m === "oidc" ? m : "unset";
}

/** TOTP sır şifreleme anahtarı. Tanımsızsa null (TOTP kullanılamaz); geçersizse açık hata. */
export function totpKey(): Buffer | null {
  const raw = process.env.TOTP_ENCRYPTION_KEY;
  if (raw === undefined || raw.trim() === "") return null;
  const key = parseTotpKey(raw);
  if (!key) throw new ConfigError("TOTP_ENCRYPTION_KEY geçersiz (32 bayt base64 olmalı)");
  return key;
}
