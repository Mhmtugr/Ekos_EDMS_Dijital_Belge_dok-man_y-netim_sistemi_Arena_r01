// Yerel kimlik modu (AUTH_MODE=local, ADR-0003). argon2id parola; hesap kilitleme (core politikası);
// oturum belirteci yalnızca özetiyle saklanır. Hatalar tek tip: kullanıcı numaralandırılamaz.
import { randomBytes, createHash } from "node:crypto";
import { DEFAULT_LOCKOUT_POLICY, isLocked, onFailedLogin, onSuccessfulLogin, type ActorContext } from "@ekos/core";
import type { PrismaClient } from "@prisma/client";
import { appendAudit } from "../audit.js";
import { loadActorContext } from "../actor.js";
import { checkLoginTotp } from "./totp.js";

export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

/** Parola karma işlemi enjekte edilir (argon2id uygulaması çağıran katmandadır; native modül bu pakete girmez). */
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
}

export type LoginResult =
  | { readonly ok: true; readonly token: string; readonly expiresAt: Date; readonly userId: string }
  | { readonly ok: false; readonly reason: "INVALID_CREDENTIALS" }
  /** Parola doğru, TOTP etkin ve kod gönderilmedi. Sayaç artırılmaz. */
  | { readonly ok: false; readonly reason: "TOTP_REQUIRED" }
  /** TOTP etkin ama sunucuda anahtar yok: giriş yapılamaz (sessiz atlama yok). */
  | { readonly ok: false; readonly reason: "TOTP_NOT_CONFIGURED" };

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Sahte doğrulama: kullanıcı yokken de aynı süre harcanır (zamanlama ile numaralandırmayı önler). */
const dummyHashes = new WeakMap<PasswordHasher, Promise<string>>();
function getDummyHash(hasher: PasswordHasher): Promise<string> {
  let h = dummyHashes.get(hasher);
  if (!h) {
    h = hasher.hash(randomBytes(24).toString("hex"));
    dummyHashes.set(hasher, h);
  }
  return h;
}

export async function authenticateLocal(
  prisma: PrismaClient,
  input: { readonly email: string; readonly password: string; readonly now: Date; readonly correlationId: string; readonly hasher: PasswordHasher; readonly userAgent?: string | null; readonly totpKey?: Buffer | null; readonly totpCode?: string | null },
): Promise<LoginResult> {
  const email = input.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.status !== "ACTIVE" || !user.passwordHash) {
    await input.hasher.verify(await getDummyHash(input.hasher), input.password).catch(() => false);
    await prisma.$transaction((tx) =>
      appendAudit(tx, { actorType: "SYSTEM", actorId: null, eventType: "LOGIN_FAILED", targetType: "User", targetId: null, outcome: "DENIED", reason: "UNKNOWN_OR_INACTIVE", correlationId: input.correlationId }),
    );
    return { ok: false, reason: "INVALID_CREDENTIALS" };
  }

  const state = { failedCount: user.failedLoginCount, lockedUntil: user.lockedUntil };
  if (isLocked(state, input.now)) {
    await prisma.$transaction((tx) =>
      appendAudit(tx, { actorType: "USER", actorId: user.id, eventType: "LOGIN_LOCKED", targetType: "User", targetId: user.id, outcome: "DENIED", correlationId: input.correlationId }),
    );
    return { ok: false, reason: "INVALID_CREDENTIALS" };
  }

  const recordFailure = async (reason: string): Promise<LoginResult> => {
    const next = onFailedLogin(state, input.now, DEFAULT_LOCKOUT_POLICY);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { failedLoginCount: next.failedCount, lockedUntil: next.lockedUntil } });
      await appendAudit(tx, { actorType: "USER", actorId: user.id, eventType: "LOGIN_FAILED", targetType: "User", targetId: user.id, outcome: "DENIED", reason, correlationId: input.correlationId });
    });
    return { ok: false, reason: "INVALID_CREDENTIALS" };
  };

  const passwordOk = await input.hasher.verify(user.passwordHash, input.password).catch(() => false);
  if (!passwordOk) return recordFailure("PASSWORD");

  let totpStep: number | null = null;
  if (user.totpEnabledAt) {
    if (!input.totpKey) return { ok: false, reason: "TOTP_NOT_CONFIGURED" };
    if (!input.totpCode) return { ok: false, reason: "TOTP_REQUIRED" };
    totpStep = checkLoginTotp(user, input.totpKey, input.totpCode, input.now);
    if (totpStep === null) return recordFailure("TOTP");
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(input.now.getTime() + SESSION_TTL_MS);
  const reset = onSuccessfulLogin();
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { failedLoginCount: reset.failedCount, lockedUntil: reset.lockedUntil, lastLoginAt: input.now, ...(totpStep !== null ? { totpLastStep: BigInt(totpStep) } : {}) },
    });
    await tx.authSession.create({
      data: { userId: user.id, tokenHash: hashToken(token), createdAt: input.now, expiresAt, lastSeenAt: input.now },
    });
    await appendAudit(tx, { actorType: "USER", actorId: user.id, eventType: "LOGIN_SUCCEEDED", targetType: "User", targetId: user.id, outcome: "SUCCESS", correlationId: input.correlationId });
  });
  return { ok: true, token, expiresAt, userId: user.id };
}

/** Belirteçten yetki bağlamı. Süresi dolmuş/iptal edilmiş/pasif kullanıcı → null. */
export async function resolveSession(prisma: PrismaClient, token: string, now: Date): Promise<ActorContext | null> {
  if (token.length < 20 || token.length > 200) return null;
  const session = await prisma.authSession.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!session || session.revokedAt || session.expiresAt.getTime() <= now.getTime()) return null;
  const actor = await loadActorContext(prisma, session.userId);
  if (actor.status !== "ACTIVE") return null;
  return actor;
}

export async function logout(prisma: PrismaClient, token: string, now: Date): Promise<void> {
  await prisma.authSession.updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: now } });
}
