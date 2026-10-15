// Webhook imza doğrulaması: HMAC-SHA256, "t=<unix>,v1=<hex>" başlığı; imzalı içerik "<t>.<gövde>".
// Zaman damgası tolerans penceresi dışındaysa (tekrar oynatma) reddedilir. Karşılaştırma sabit süreli.
import { createHmac, timingSafeEqual } from "node:crypto";

export const WEBHOOK_TOLERANCE_S = 300;

export function signWebhookPayload(secret: string, unixSeconds: number, rawBody: string): string {
  const v1 = createHmac("sha256", secret).update(`${String(unixSeconds)}.${rawBody}`).digest("hex");
  return `t=${String(unixSeconds)},v1=${v1}`;
}

export type WebhookVerdict = { ok: true } | { ok: false; code: "SIGNATURE_MISSING" | "SIGNATURE_INVALID" | "TIMESTAMP_OUT_OF_RANGE" };

export function verifyWebhookSignature(input: { secret: string; header: string | null; rawBody: string; nowUnixSeconds: number; toleranceS?: number }): WebhookVerdict {
  if (!input.header) return { ok: false, code: "SIGNATURE_MISSING" };
  const parts = Object.fromEntries(input.header.split(",").map((p) => p.trim().split("=", 2) as [string, string]));
  const t = Number(parts.t);
  const v1 = parts.v1 ?? "";
  if (!Number.isInteger(t) || !/^[0-9a-f]{64}$/.test(v1)) return { ok: false, code: "SIGNATURE_INVALID" };
  if (Math.abs(input.nowUnixSeconds - t) > (input.toleranceS ?? WEBHOOK_TOLERANCE_S)) return { ok: false, code: "TIMESTAMP_OUT_OF_RANGE" };
  const expected = createHmac("sha256", input.secret).update(`${String(t)}.${input.rawBody}`).digest();
  const given = Buffer.from(v1, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, code: "SIGNATURE_INVALID" };
  return { ok: true };
}
