// Kırılma-cam (Faz 4, madde 5): talep → gerekçe → süre → İKİNCİ kişinin onayı → süreli erişim → görünür denetim.
// Erişim yalnızca loadActorContext + authorize() ile verilir; talep eden dışında kimse kullanamaz.
import { authorize, isPermissionCode, uuidv7, validateBreakGlassDuration, type ActorContext } from "@ekos/core";
import { type PrismaClient } from "@prisma/client";
import { appendAudit } from "../audit.js";
import { guardDocument } from "../documents/guard.js";
import { DomainError } from "../documents/shared.js";
import { recordDenied, requireGlobal } from "./common.js";

/** Talep: normal yetki yoksa, gerekçe ve süre (15–240 dk) ile istenir. Normal yetki varsa talep reddedilir. */
export async function requestBreakGlass(
  prisma: PrismaClient,
  input: { actor: ActorContext; now: Date; correlationId: string; permission: string; documentId: string; reason: string; durationMinutes: number },
): Promise<{ grantId: string; expiresAtIfApproved: Date }> {
  if (!isPermissionCode(input.permission)) throw new DomainError("BREAK_GLASS_INVALID", "İzin kodu geçersiz");
  if (validateBreakGlassDuration(input.durationMinutes) !== "OK") throw new DomainError("BREAK_GLASS_INVALID", "Süre 15 ile 240 dakika arasında olmalı");
  const reason = input.reason.trim();
  if (!reason) throw new DomainError("REASON_REQUIRED");
  const doc = await prisma.document.findUnique({ where: { id: input.documentId }, select: { id: true } });
  if (!doc) throw new DomainError("NOT_FOUND");
  let normallyAllowed = false;
  try {
    await guardDocument(prisma, { actor: input.actor, now: input.now, documentId: input.documentId, permission: input.permission });
    normallyAllowed = true;
  } catch {
    normallyAllowed = false;
  }
  if (normallyAllowed) throw new DomainError("BREAK_GLASS_INVALID", "Bu belge için normal yetkiniz var; kırılma-cam gerekmez");
  const grantId = uuidv7();
  const expiresAt = new Date(input.now.getTime() + input.durationMinutes * 60_000);
  await prisma.$transaction(async (tx) => {
    await tx.breakGlassGrant.create({
      data: {
        id: grantId, requesterId: input.actor.userId, subjectType: "DOCUMENT", subjectId: input.documentId,
        permissionCode: input.permission, reason, status: "REQUESTED", createdAt: input.now, expiresAt,
      },
    });
    await appendAudit(tx, {
      actorType: "USER", actorId: input.actor.userId, eventType: "BREAK_GLASS_REQUESTED", targetType: "DOCUMENT", targetId: input.documentId,
      outcome: "SUCCESS", reason, correlationId: input.correlationId, afterSummary: { grantId, permission: input.permission, durationMinutes: input.durationMinutes },
    });
  });
  return { grantId, expiresAtIfApproved: expiresAt };
}

/** Onay: onaylayan talep edenden FARKLI olmalı ve breakglass.approve yetkisine sahip olmalıdır. Süre onayda yeniden başlar. */
export async function approveBreakGlass(
  prisma: PrismaClient,
  input: { actor: ActorContext; now: Date; correlationId: string; grantId: string },
): Promise<{ startsAt: Date; expiresAt: Date }> {
  const g = await prisma.breakGlassGrant.findUnique({ where: { id: input.grantId } });
  if (!g) throw new DomainError("NOT_FOUND");
  if (g.requesterId === input.actor.userId) {
    await recordDenied(prisma, { actorId: input.actor.userId, eventType: "BREAK_GLASS_APPROVE_DENIED", targetType: "DOCUMENT", targetId: g.subjectId, reason: "SELF_APPROVAL", correlationId: input.correlationId });
    throw new DomainError("SEPARATION_OF_DUTIES", "Talep eden kişi kendi kırılma-cam talebini onaylayamaz");
  }
  try {
    requireGlobal(input.actor, "breakglass.approve", input.now);
  } catch (err) {
    await recordDenied(prisma, { actorId: input.actor.userId, eventType: "BREAK_GLASS_APPROVE_DENIED", targetType: "DOCUMENT", targetId: g.subjectId, reason: "NO_PERMISSION", correlationId: input.correlationId });
    throw err;
  }
  if (g.status !== "REQUESTED") throw new DomainError("BREAK_GLASS_INVALID", "Talep beklemede değil");
  const durationMs = g.expiresAt ? g.expiresAt.getTime() - g.createdAt.getTime() : 0;
  if (validateBreakGlassDuration(Math.round(durationMs / 60_000)) !== "OK") throw new DomainError("BREAK_GLASS_INVALID", "Talep süresi geçersiz");
  const startsAt = input.now;
  const expiresAt = new Date(startsAt.getTime() + durationMs);
  await prisma.$transaction(async (tx) => {
    const upd = await tx.breakGlassGrant.updateMany({
      where: { id: g.id, status: "REQUESTED" },
      data: { status: "APPROVED", approverId: input.actor.userId, approvedAt: input.now, startsAt, expiresAt },
    });
    if (upd.count !== 1) throw new DomainError("BREAK_GLASS_INVALID", "Talep beklemede değil");
    await appendAudit(tx, {
      actorType: "USER", actorId: input.actor.userId, eventType: "BREAK_GLASS_APPROVED", targetType: "DOCUMENT", targetId: g.subjectId,
      outcome: "SUCCESS", correlationId: input.correlationId, afterSummary: { grantId: g.id, requesterId: g.requesterId, permission: g.permissionCode, startsAt, expiresAt },
    });
  });
  return { startsAt, expiresAt };
}

/** Red: onaylayan talep edenden farklı olmalı; gerekçe zorunlu. */
export async function rejectBreakGlass(prisma: PrismaClient, input: { actor: ActorContext; now: Date; correlationId: string; grantId: string; reason: string }): Promise<void> {
  const g = await prisma.breakGlassGrant.findUnique({ where: { id: input.grantId } });
  if (!g) throw new DomainError("NOT_FOUND");
  if (g.requesterId === input.actor.userId) throw new DomainError("SEPARATION_OF_DUTIES", "Talep eden kişi kendi talebini reddedemez");
  requireGlobal(input.actor, "breakglass.approve", input.now);
  const reason = input.reason.trim();
  if (!reason) throw new DomainError("REASON_REQUIRED");
  await prisma.$transaction(async (tx) => {
    const upd = await tx.breakGlassGrant.updateMany({ where: { id: g.id, status: "REQUESTED" }, data: { status: "REJECTED", approverId: input.actor.userId } });
    if (upd.count !== 1) throw new DomainError("BREAK_GLASS_INVALID", "Talep beklemede değil");
    await appendAudit(tx, {
      actorType: "USER", actorId: input.actor.userId, eventType: "BREAK_GLASS_REJECTED", targetType: "DOCUMENT", targetId: g.subjectId,
      outcome: "SUCCESS", reason, correlationId: input.correlationId, afterSummary: { grantId: g.id },
    });
  });
}

/** İptal: onaylı kırılma-cam kaydını süresinden önce kaldırır. Yetki: breakglass.approve; gerekçe zorunlu. */
export async function revokeBreakGlass(prisma: PrismaClient, input: { actor: ActorContext; now: Date; correlationId: string; grantId: string; reason: string }): Promise<void> {
  requireGlobal(input.actor, "breakglass.approve", input.now);
  const g = await prisma.breakGlassGrant.findUnique({ where: { id: input.grantId } });
  if (!g) throw new DomainError("NOT_FOUND");
  const reason = input.reason.trim();
  if (!reason) throw new DomainError("REASON_REQUIRED");
  await prisma.$transaction(async (tx) => {
    const upd = await tx.breakGlassGrant.updateMany({ where: { id: g.id, status: "APPROVED" }, data: { status: "REVOKED" } });
    if (upd.count !== 1) throw new DomainError("BREAK_GLASS_INVALID", "Yalnız onaylı kayıt iptal edilebilir");
    await appendAudit(tx, {
      actorType: "USER", actorId: input.actor.userId, eventType: "BREAK_GLASS_REVOKED", targetType: "DOCUMENT", targetId: g.subjectId,
      outcome: "SUCCESS", reason, correlationId: input.correlationId, afterSummary: { grantId: g.id },
    });
  });
}

/** Süresi dolan onaylı kayıtları EXPIRED yapar (sistem işi). Her kayıt için denetim olayı. */
export async function expireBreakGlassGrants(prisma: PrismaClient, input: { now: Date; correlationId: string }): Promise<number> {
  const due = await prisma.breakGlassGrant.findMany({ where: { status: "APPROVED", expiresAt: { lte: input.now } }, select: { id: true, subjectId: true } });
  let n = 0;
  for (const g of due) {
    await prisma.$transaction(async (tx) => {
      const upd = await tx.breakGlassGrant.updateMany({ where: { id: g.id, status: "APPROVED" }, data: { status: "EXPIRED" } });
      if (upd.count !== 1) return;
      n += 1;
      await appendAudit(tx, {
        actorType: "SYSTEM", actorId: null, eventType: "BREAK_GLASS_EXPIRED", targetType: "DOCUMENT", targetId: g.subjectId,
        outcome: "SUCCESS", correlationId: input.correlationId, afterSummary: { grantId: g.id },
      });
    });
  }
  return n;
}

/**
 * Kırılma-cam kullanımı: erişim gerçekleştiğinde görünür denetim kaydı yazılır (actorType BREAK_GLASS).
 * Kayıt APPROVED, talep edene ait ve süresi dolmamış değilse kullanım reddedilir.
 */
export async function recordBreakGlassUse(
  prisma: PrismaClient,
  input: { actor: ActorContext; now: Date; correlationId: string; grantId: string; eventType: string; targetType: string; targetId: string },
): Promise<void> {
  const g = await prisma.breakGlassGrant.findUnique({ where: { id: input.grantId } });
  const valid = !!g && g.status === "APPROVED" && g.requesterId === input.actor.userId && !!g.expiresAt && g.expiresAt > input.now && (!g.startsAt || g.startsAt <= input.now);
  if (!valid) throw new DomainError("FORBIDDEN", "Kırılma-cam kaydı bu kullanım için geçerli değil");
  if (g.subjectId !== input.targetId) throw new DomainError("FORBIDDEN", "Kırılma-cam kaydı bu kaynak için değil");
  await prisma.$transaction((tx) =>
    appendAudit(tx, {
      actorType: "BREAK_GLASS", actorId: input.actor.userId, eventType: input.eventType, targetType: input.targetType, targetId: input.targetId,
      outcome: "SUCCESS", correlationId: input.correlationId, afterSummary: { grantId: g.id, permission: g.permissionCode, via: "BREAK_GLASS" },
    }),
  );
}


/** Kırılma-cam kayıtları: talep eden kendi kayıtlarını; breakglass.approve sahibi ise bekleyen talepleri görür. */
export const BREAK_GLASS_PAGE_SIZE = 50;

/** Sayfalı liste: sayfa başına 50 kayıt; hasMore bir sonraki sayfanın varlığını bildirir. */
export async function listBreakGlassGrants(prisma: PrismaClient, input: { actor: ActorContext; now: Date; page?: number }) {
  const canApprove = authorize({ actor: input.actor, permission: "breakglass.approve", now: input.now }).allowed;
  const page = Number.isInteger(input.page) && (input.page ?? 0) >= 1 ? (input.page as number) : 1;
  const rows = await prisma.breakGlassGrant.findMany({
    where: canApprove ? { OR: [{ requesterId: input.actor.userId }, { status: "REQUESTED" }] } : { requesterId: input.actor.userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * BREAK_GLASS_PAGE_SIZE,
    take: BREAK_GLASS_PAGE_SIZE + 1,
  });
  const hasMore = rows.length > BREAK_GLASS_PAGE_SIZE;
  const items = rows.slice(0, BREAK_GLASS_PAGE_SIZE).map((g) => ({
    id: g.id,
    requesterId: g.requesterId,
    approverId: g.approverId,
    subjectId: g.subjectId,
    permissionCode: g.permissionCode,
    reason: g.reason,
    status: g.status,
    startsAt: g.startsAt,
    expiresAt: g.expiresAt,
    createdAt: g.createdAt,
  }));
  return { items, hasMore, page };
}
