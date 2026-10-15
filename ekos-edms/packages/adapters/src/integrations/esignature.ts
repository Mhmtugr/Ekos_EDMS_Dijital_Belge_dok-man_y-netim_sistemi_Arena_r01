// E-imza sağlayıcı adaptörü (genel HTTP sözleşmesi). Tamamlanma olayı: işlem kimliği + taraflar + zaman + imzalı dosya.
// Dosya bütünlüğü: olayda gelen SHA-256 ile çözülen dosya karşılaştırılır; uyuşmazsa olay reddedilir.
import { createHash } from "node:crypto";
import { validateRuntimeConfig } from "@ekos/core";
import { IntegrationError, readEnv, type Env } from "./types.js";

export const ESIGN_KEY = "esignature";
export const ESIGN_REQUIRED_ENV = ["ESIGN_API_BASE_URL", "ESIGN_API_TOKEN", "ESIGN_WEBHOOK_SECRET"] as const;

export interface ESignConfig {
  readonly baseUrl: string;
  readonly token: string;
  readonly webhookSecret: string;
  /** Sağlayıcı çağrı zaman aşımı (ESIGN_TIMEOUT_MS; varsayılan 30 sn). */
  readonly timeoutMs?: number;
}

export function readESignConfig(env: Env): ESignConfig | null {
  const baseUrl = readEnv(env, "ESIGN_API_BASE_URL");
  const token = readEnv(env, "ESIGN_API_TOKEN");
  const webhookSecret = readEnv(env, "ESIGN_WEBHOOK_SECRET");
  if (!baseUrl || !token || !webhookSecret) return null;
  if (!/^https:\/\//.test(baseUrl)) throw new IntegrationError("ESIGN_BASE_URL_NOT_HTTPS", false, "E-imza adresi https olmalı");
  return { baseUrl: baseUrl.replace(/\/+$/, ""), token, webhookSecret, timeoutMs: validateRuntimeConfig(env, { production: false }).limits.esignTimeoutMs };
}

export interface CreateSignTransactionInput {
  readonly externalRef: string;
  readonly documentName: string;
  readonly documentBase64: string;
  readonly signers: readonly { readonly name: string; readonly email: string }[];
}

/** İşlem oluşturur; dönen işlem kimliği dış kayıt referansı olarak saklanır. */
export async function createSignTransaction(cfg: ESignConfig, input: CreateSignTransactionInput, fetchFn: typeof fetch = fetch): Promise<{ transactionId: string }> {
  let res: Response;
  try {
    res = await fetchFn(`${cfg.baseUrl}/transactions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ externalRef: input.externalRef, document: { name: input.documentName, base64: input.documentBase64 }, signers: input.signers }),
      signal: AbortSignal.timeout(cfg.timeoutMs ?? 30_000),
    });
  } catch {
    throw new IntegrationError("ESIGN_UNREACHABLE", true);
  }
  if (!res.ok) throw new IntegrationError(`ESIGN_HTTP_${String(res.status)}`, res.status >= 500);
  const body = (await res.json().catch(() => null)) as { id?: unknown } | null;
  if (!body || typeof body.id !== "string" || body.id.length === 0 || body.id.length > 200) throw new IntegrationError("ESIGN_RESPONSE_INVALID", false);
  return { transactionId: body.id };
}

export interface SignCompletion {
  readonly eventId: string;
  readonly transactionId: string;
  readonly signedAt: Date;
  readonly parties: readonly { readonly name: string; readonly email: string; readonly signedAt: Date }[];
  readonly signedFile: Uint8Array;
  readonly signedFileSha256: string;
}

/** Tamamlanma olayını doğrular (şema + dosya SHA-256). Geçersizse IntegrationError. */
export function parseSignCompletion(payload: unknown): SignCompletion {
  const p = (payload ?? {}) as Record<string, unknown>;
  const data = (p.data ?? {}) as Record<string, unknown>;
  const doc = (data.document ?? {}) as Record<string, unknown>;
  const bad = (): never => {
    throw new IntegrationError("ESIGN_EVENT_INVALID", false);
  };
  if (p.type !== "transaction.completed") bad();
  if (typeof p.id !== "string" || p.id.length === 0 || p.id.length > 200) bad();
  if (typeof data.transactionId !== "string" || data.transactionId.length === 0 || data.transactionId.length > 200) bad();
  const signedAt = new Date(String(data.signedAt));
  if (typeof data.signedAt !== "string" || Number.isNaN(signedAt.getTime())) bad();
  if (!Array.isArray(data.parties) || data.parties.length === 0 || data.parties.length > 20) bad();
  const parties = (data.parties as Record<string, unknown>[]).map((x) => {
    const at = new Date(String(x.signedAt));
    if (typeof x.name !== "string" || typeof x.email !== "string" || typeof x.signedAt !== "string" || Number.isNaN(at.getTime())) bad();
    return { name: String(x.name).slice(0, 200), email: String(x.email).slice(0, 320).toLowerCase(), signedAt: at };
  });
  if (typeof doc.base64 !== "string" || typeof doc.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(doc.sha256)) bad();
  const file = new Uint8Array(Buffer.from(doc.base64 as string, "base64"));
  if (file.length === 0) bad();
  const actual = createHash("sha256").update(file).digest("hex");
  if (actual !== doc.sha256) throw new IntegrationError("ESIGN_FILE_HASH_MISMATCH", false, "İmzalı dosya bütünlük denetimini geçemedi");
  return { eventId: p.id as string, transactionId: data.transactionId as string, signedAt, parties, signedFile: file, signedFileSha256: actual };
}
