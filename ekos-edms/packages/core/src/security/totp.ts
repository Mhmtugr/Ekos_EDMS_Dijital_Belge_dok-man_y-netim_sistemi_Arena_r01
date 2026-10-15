// RFC 6238 (TOTP) — HMAC-SHA1, 30 sn, 6 hane. RFC 4648 base32. Yalnızca standart kütüphane (node:crypto).
import { createHmac, timingSafeEqual } from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31] ?? "";
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31] ?? "";
  return out;
}

export function base32Decode(input: string): Uint8Array {
  const clean = input.replace(/=+$/g, "").toUpperCase().replace(/\s/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("Geçersiz base32 karakteri");
    value = ((value << 5) | idx) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

export function totpAt(secret: Uint8Array, unixSeconds: number, digits = 6, period = 30): string {
  const counter = Math.floor(unixSeconds / period);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac("sha1", secret).update(buf).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  const code =
    (((hmac[offset] ?? 0) & 0x7f) << 24) |
    (((hmac[offset + 1] ?? 0) & 0xff) << 16) |
    (((hmac[offset + 2] ?? 0) & 0xff) << 8) |
    ((hmac[offset + 3] ?? 0) & 0xff);
  return (code % 10 ** digits).toString().padStart(digits, "0");
}

/**
 * ±window adım içinde kodu arar. Eşleşen ADIMI döner (aynı adımın tekrar kullanımını
 * engellemek için çağıran taraf son kullanılan adımı saklamalıdır); yoksa null.
 */
export function verifyTotp(
  secret: Uint8Array,
  code: string,
  unixSeconds: number,
  window = 1,
  period = 30,
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(unixSeconds / period);
  const given = Buffer.from(code);
  let matched: number | null = null;
  for (let delta = -window; delta <= window; delta++) {
    const step = current + delta;
    const expected = Buffer.from(totpAt(secret, step * period, 6, period));
    if (expected.length === given.length && timingSafeEqual(expected, given)) matched = step;
  }
  return matched;
}

export function otpauthUri(issuer: string, account: string, secret: Uint8Array): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: base32Encode(secret),
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
