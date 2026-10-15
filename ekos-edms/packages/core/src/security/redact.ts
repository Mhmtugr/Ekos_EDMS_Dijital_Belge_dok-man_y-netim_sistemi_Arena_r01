// Hassas alan redaksiyonu (log ve denetim özetleri). Belge içeriği, OCR metni, parola, token, secret asla yazılmaz.
const SENSITIVE_KEY =
  /pass(word)?|secret|token|cookie|authorization|otp|totp|content|ocr|body|ciphertext|private|hash$/i;

export const REDACTED = "[REDACTED]";

export function redact<T>(value: T): T {
  return redactValue(value, 0) as T;
}

function redactValue(value: unknown, depth: number): unknown {
  if (depth > 20) return REDACTED;
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redactValue(v, depth + 1);
  }
  return out;
}
