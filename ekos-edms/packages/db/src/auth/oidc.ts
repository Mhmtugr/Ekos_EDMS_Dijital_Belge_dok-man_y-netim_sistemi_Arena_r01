// OIDC (Entra ID) oturum servisleri (Faz 6 madde 2). Kural: otomatik kullanıcı oluşturulmaz (deny-by-default).
// E-posta eşleşen ACTIVE kullanıcı yoksa giriş reddedilir. Grup eşlemesi yalnız-ekleme politikasıyla uygulanır.
import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { appendAudit } from "../audit.js";
import { applyIdentityGroups } from "../integrations/identity.js";
import { SESSION_TTL_MS, hashToken } from "./local.js";

export const OIDC_LOGIN_TTL_MS = 10 * 60 * 1000;

export async function createOidcLoginRequest(
  prisma: PrismaClient,
  input: { readonly state: string; readonly nonce: string; readonly codeVerifier: string; readonly now: Date },
): Promise<void> {
  // Süresi dolmuş istekler temizlenir (birikme yok).
  await prisma.oidcLoginRequest.deleteMany({ where: { expiresAt: { lte: input.now } } });
  await prisma.oidcLoginRequest.create({
    data: {
      state: input.state,
      nonce: input.nonce,
      codeVerifier: input.codeVerifier,
      createdAt: input.now,
      expiresAt: new Date(input.now.getTime() + OIDC_LOGIN_TTL_MS),
    },
  });
}

/** Tek kullanımlık tüketim: state bir kez ve yalnız süresi dolmadan kullanılabilir. */
export async function consumeOidcLoginRequest(
  prisma: PrismaClient,
  state: string,
  now: Date,
): Promise<{ readonly nonce: string; readonly codeVerifier: string } | null> {
  const row = await prisma.oidcLoginRequest.findUnique({ where: { state } });
  if (!row) return null;
  const deleted = await prisma.oidcLoginRequest.deleteMany({ where: { state, expiresAt: { gt: now } } });
  if (deleted.count !== 1) return null;
  return { nonce: row.nonce, codeVerifier: row.codeVerifier };
}

export type OidcLoginOutcome =
  | { readonly ok: true; readonly token: string; readonly expiresAt: Date; readonly userId: string; readonly groupSync: "APPLIED" | "SKIPPED_OVERAGE" }
  | { readonly ok: false; readonly reason: "USER_NOT_PROVISIONED" | "USER_INACTIVE" };

export async function completeOidcLogin(
  prisma: PrismaClient,
  input: {
    readonly providerKey: string;
    readonly email: string;
    readonly externalGroups: readonly string[] | null;
    readonly correlationId: string;
    readonly now: Date;
    readonly userAgent: string | null;
  },
): Promise<OidcLoginOutcome> {
  const email = input.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, status: true } });
  if (!user) {
    await prisma.$transaction((tx) =>
      appendAudit(tx, { actorType: "SYSTEM", actorId: null, eventType: "OIDC_LOGIN_DENIED", targetType: "User", targetId: null, outcome: "DENIED", reason: "USER_NOT_PROVISIONED", correlationId: input.correlationId }),
    );
    return { ok: false, reason: "USER_NOT_PROVISIONED" };
  }
  if (user.status !== "ACTIVE") {
    await prisma.$transaction((tx) =>
      appendAudit(tx, { actorType: "USER", actorId: user.id, eventType: "OIDC_LOGIN_DENIED", targetType: "User", targetId: user.id, outcome: "DENIED", reason: "USER_INACTIVE", correlationId: input.correlationId }),
    );
    return { ok: false, reason: "USER_INACTIVE" };
  }
  const sync = await applyIdentityGroups(prisma, {
    userId: user.id,
    providerKey: input.providerKey,
    externalGroups: input.externalGroups,
    correlationId: input.correlationId,
  });
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(input.now.getTime() + SESSION_TTL_MS);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: input.now, failedLoginCount: 0, lockedUntil: null } });
    await tx.authSession.create({
      data: { userId: user.id, tokenHash: hashToken(token), createdAt: input.now, expiresAt, lastSeenAt: input.now },
    });
    await appendAudit(tx, {
      actorType: "USER",
      actorId: user.id,
      eventType: "LOGIN_SUCCEEDED",
      targetType: "User",
      targetId: user.id,
      outcome: "SUCCESS",
      reason: "OIDC",
      correlationId: input.correlationId,
      afterSummary: { provider: input.providerKey, userAgentPresent: input.userAgent !== null },
    });
  });
  return { ok: true, token, expiresAt, userId: user.id, groupSync: sync.status === "APPLIED" ? "APPLIED" : "SKIPPED_OVERAGE" };
}
