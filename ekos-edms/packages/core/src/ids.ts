// UUIDv7 üretimi (RFC 9562): 48-bit ms zaman damgası + sürüm 7 + rastgele bitler. Kimlikler UUIDv7'dir (kural).
import { randomBytes } from "node:crypto";

export function uuidv7(nowMs: number = Date.now()): string {
  if (!Number.isInteger(nowMs) || nowMs < 0 || nowMs > 0xffffffffffff) throw new Error("Geçersiz zaman damgası");
  const rand = randomBytes(10);
  const b = Buffer.alloc(16);
  b.writeUIntBE(nowMs, 0, 6);
  b[6] = 0x70 | (rand[0] ?? 0) & 0x0f; // sürüm 7
  b[7] = rand[1] ?? 0;
  b[8] = 0x80 | (rand[2] ?? 0) & 0x3f; // varyant RFC 4122
  rand.copy(b, 9, 3, 10);
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const UUID_V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
