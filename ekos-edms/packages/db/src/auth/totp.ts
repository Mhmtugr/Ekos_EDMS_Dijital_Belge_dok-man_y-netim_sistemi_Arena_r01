// TOTP (RFC 6238) ikinci faktör. Sır AES-256-GCM ile şifrelenir; anahtar ortam değişkeninden gelir
// (TOTP_ENCRYPTION_KEY, base64 32 bayt). Anahtar yoksa TOTP kullanılamaz; sessiz atlama yoktur.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { base32Encode, otpauthUri, verifyTotp } from "@ekos/core";
import type { PrismaClient } from "@prisma/client";
import { appendAudit } from "../audit.js";

export const TOTP_ISSUER = "EKOS EDMS";

/** Ortam anahtarını doğrular. Geçersiz/yoksa null. */
export function parseTotpKey(raw: string | undefined): Buffer | null {
  if (!raw) return null;
  const key = Buffer.from(raw.trim(), "base64");
  return key.length === 32 ? key : null;
}

export function encryptSecret(key: Buffer, secret: Uint8Array): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  const ct = Buffer.concat([cipher.update(secret), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decryptSecret(key: Buffer, cipherText: string): Uint8Array {
  const parts = cipherText.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("TOTP sırrı biçimi geçersiz");
  const [, ivB, tagB, ctB] = parts as [string, string, string, string];
  const tag = Buffer.from(tagB, "base64");
  if (tag.length !== 16) throw new Error("TOTP sırrı doğrulama etiketi geçersiz");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB, "base64"), { authTagLength: 16 });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(Buffer.from(ctB, "base64")), decipher.final()]);
}

/** Kurulum: yeni sır üretir, şifreli saklar (henüz etkin değil). Etkin hesapta reddedilir. */
export async function beginTotpEnrollment(
  prisma: PrismaClient,
  input: { readonly userId: string; readonly key: Buffer; readonly now: Date; readonly correlationId: string },
): Promise<{ readonly secretBase32: string; readonly otpauthUri: string } | "ALREADY_ENABLED"> {
  const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { email: true, totpEnabledAt: true } });
  if (!user) return "ALREADY_ENABLED";
  if (user.totpEnabledAt) return "ALREADY_ENABLED";
  const secret = randomBytes(20);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: input.userId },
      data: { totpSecretCipher: encryptSecret(input.key, secret), totpLastStep: null, updatedBy: input.userId },
    });
    await appendAudit(tx, { actorType: "USER", actorId: input.userId, eventType: "TOTP_ENROLLMENT_STARTED", targetType: "User", targetId: input.userId, outcome: "SUCCESS", correlationId: input.correlationId });
  });
  return { secretBase32: base32Encode(secret), otpauthUri: otpauthUri(TOTP_ISSUER, user.email, secret) };
}

/** Onay: kullanıcı uygulamasındaki kodu girer; doğruysa TOTP etkinleşir. */
export async function confirmTotpEnrollment(
  prisma: PrismaClient,
  input: { readonly userId: string; readonly key: Buffer; readonly code: string; readonly now: Date; readonly correlationId: string },
): Promise<"OK" | "INVALID_CODE" | "NOT_PENDING"> {
  const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { totpSecretCipher: true, totpEnabledAt: true } });
  if (!user || user.totpEnabledAt || !user.totpSecretCipher) return "NOT_PENDING";
  const secret = decryptSecret(input.key, user.totpSecretCipher);
  const step = verifyTotp(secret, input.code, Math.floor(input.now.getTime() / 1000));
  if (step === null) return "INVALID_CODE";
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: input.userId }, data: { totpEnabledAt: input.now, totpLastStep: BigInt(step), updatedBy: input.userId } });
    await appendAudit(tx, { actorType: "USER", actorId: input.userId, eventType: "TOTP_ENABLED", targetType: "User", targetId: input.userId, outcome: "SUCCESS", correlationId: input.correlationId });
  });
  return "OK";
}

/** Giriş sırasında kodu doğrular. Dönüş: kabul edilen adım veya null. Tekrar kullanım engellenir. */
export function checkLoginTotp(
  user: { readonly totpSecretCipher: string | null; readonly totpLastStep: bigint | null },
  key: Buffer,
  code: string,
  now: Date,
): number | null {
  if (!user.totpSecretCipher) return null;
  const secret = decryptSecret(key, user.totpSecretCipher);
  const step = verifyTotp(secret, code, Math.floor(now.getTime() / 1000));
  if (step === null) return null;
  if (user.totpLastStep !== null && BigInt(step) <= user.totpLastStep) return null;
  return step;
}
