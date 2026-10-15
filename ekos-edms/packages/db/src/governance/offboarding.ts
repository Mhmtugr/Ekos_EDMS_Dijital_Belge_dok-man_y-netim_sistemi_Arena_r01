// Personel ayrılışı ve sorumluluk devri (Faz 4, madde 4). Kullanıcı SİLİNMEZ: durumu OFFBOARDING→DISABLED olur.
// Açık sorumluluklar (sahiplik, sözleşme rolleri, yükümlülük, bekleyen onay) kalem olarak listelenir ve
// yetkili bir kullanıcıya devredilir. Geçmiş etkinlikler değişmez. Ayrılan kişi adına işlem authorize() ile engellenir.
import { canCompleteOffboarding, uuidv7, type ActorContext } from "@ekos/core";
import { type PrismaClient } from "@prisma/client";
import { loadActorContext } from "../actor.js";
import { guardDocument } from "../documents/guard.js";
import { DomainError } from "../documents/shared.js";
import { recordDenied, requireGlobal } from "./common.js";
import { appendAudit } from "../audit.js";

const OPEN_OBLIGATION_STATUSES = ["OPEN", "OVERDUE", "NEEDS_MANUAL_VERIFICATION"] as const;
const CONTRACT_FIELDS = ["businessOwnerId", "requesterId", "contractManagerId", "legalReviewerId"] as const;
type ContractField = (typeof CONTRACT_FIELDS)[number];

/** Dosya açıldığında kullanıcının sorumluluklarını tarar; kalemleri oluşturur, hesabı OFFBOARDING yapar, oturumları kapatır. */
export async function openOffboardingCase(
  prisma: PrismaClient,
  input: { actor: ActorContext; now: Date; correlationId: string; userId: string; reason: string; blockOnUnresolved: boolean },
): Promise<{ caseId: string; itemCount: number }> {
  requireGlobal(input.actor, "user.manage", input.now);
  if (input.userId === input.actor.userId) throw new DomainError("OFFBOARDING_STATE_INVALID", "Kendi hesabınız için ayrılış dosyası açılamaz");
  const reason = input.reason.trim();
  if (!reason) throw new DomainError("REASON_REQUIRED");

  const caseId = uuidv7();
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: input.userId } });
    if (!user) throw new DomainError("NOT_FOUND");
    if (user.status !== "ACTIVE") throw new DomainError("OFFBOARDING_STATE_INVALID", "Yalnızca aktif hesap için ayrılış dosyası açılabilir");
    const openCase = await tx.offboardingCase.findFirst({ where: { userId: user.id, status: "OPEN" } });
    if (openCase) throw new DomainError("OFFBOARDING_STATE_INVALID", "Bu kullanıcı için açık bir ayrılış dosyası zaten var");

    const items: { kind: "DOCUMENT_OWNER" | "CONTRACT_ROLE" | "OBLIGATION_RESPONSIBLE" | "APPROVAL_TASK"; targetId: string; field: string }[] = [];

    const docs = await tx.document.findMany({ where: { ownerId: user.id, generalStatus: { not: "DISPOSED" } }, select: { id: true } });
    for (const d of docs) items.push({ kind: "DOCUMENT_OWNER", targetId: d.id, field: "ownerId" });

    const contracts = await tx.contractRecord.findMany({
      where: { OR: CONTRACT_FIELDS.map((f) => ({ [f]: user.id })) },
    });
    for (const c of contracts) {
      for (const f of CONTRACT_FIELDS) if (c[f] === user.id) items.push({ kind: "CONTRACT_ROLE", targetId: c.id, field: f });
    }

    const obligations = await tx.obligation.findMany({
      where: { responsibleUserId: user.id, status: { in: [...OPEN_OBLIGATION_STATUSES] } },
      select: { id: true },
    });
    for (const o of obligations) items.push({ kind: "OBLIGATION_RESPONSIBLE", targetId: o.id, field: "responsibleUserId" });

    const tasks = await tx.approvalTask.findMany({ where: { assigneeId: user.id, status: "PENDING" }, select: { id: true } });
    for (const t of tasks) items.push({ kind: "APPROVAL_TASK", targetId: t.id, field: "assigneeId" });

    await tx.offboardingCase.create({
      data: {
        id: caseId, userId: user.id, status: "OPEN", reason, blockOnUnresolved: input.blockOnUnresolved, openedById: input.actor.userId,
        openedAt: input.now,
        items: { create: items.map((i) => ({ id: uuidv7(), kind: i.kind, targetId: i.targetId, field: i.field, status: "OPEN", createdAt: input.now })) },
      },
    });
    await tx.user.update({ where: { id: user.id }, data: { status: "OFFBOARDING", updatedBy: input.actor.userId } });
    // Oturumlar hemen kapatılır: ayrılan kişi bir sonraki istekte oturum açamaz.
    await tx.authSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: input.now } });
    await appendAudit(tx, {
      actorType: "USER", actorId: input.actor.userId, eventType: "OFFBOARDING_OPENED", targetType: "USER", targetId: user.id,
      outcome: "SUCCESS", reason, correlationId: input.correlationId,
      afterSummary: { caseId, itemCount: items.length, blockOnUnresolved: input.blockOnUnresolved },
    });
    return { caseId, itemCount: items.length };
  });
}

async function loadCaseAndItem(prisma: PrismaClient, caseId: string, itemId: string) {
  const c = await prisma.offboardingCase.findUnique({ where: { id: caseId } });
  if (!c) throw new DomainError("NOT_FOUND");
  const item = await prisma.offboardingItem.findFirst({ where: { id: itemId, caseId } });
  if (!item) throw new DomainError("NOT_FOUND");
  return { c, item };
}

/** Hedef kullanıcının devralacağı kaynak için yetkisini doğrular (gerçek authorize yolu). */
async function assertRecipientCanHold(
  prisma: PrismaClient,
  recipient: ActorContext,
  now: Date,
  kind: "DOCUMENT_OWNER" | "CONTRACT_ROLE" | "OBLIGATION_RESPONSIBLE" | "APPROVAL_TASK",
  targetId: string,
  field: string,
): Promise<string> {
  const deny = () => new DomainError("OFFBOARDING_STATE_INVALID", "Devir alıcısı bu kaynak için yetkili değil");
  const check = async (documentId: string, permission: string) => {
    try {
      await guardDocument(prisma, { actor: recipient, now, documentId, permission });
    } catch {
      throw deny();
    }
  };
  switch (kind) {
    case "DOCUMENT_OWNER":
      await check(targetId, "document.edit_metadata");
      return targetId;
    case "CONTRACT_ROLE": {
      const contract = await prisma.contractRecord.findUniqueOrThrow({ where: { id: targetId }, select: { documentId: true } });
      await check(contract.documentId, field === "legalReviewerId" ? "contract.legal_review" : "contract.manage_obligations");
      return contract.documentId;
    }
    case "OBLIGATION_RESPONSIBLE": {
      const ob = await prisma.obligation.findUniqueOrThrow({ where: { id: targetId }, select: { contractId: true } });
      const contract = await prisma.contractRecord.findUniqueOrThrow({ where: { id: ob.contractId }, select: { documentId: true } });
      await check(contract.documentId, "contract.manage_obligations");
      return contract.documentId;
    }
    case "APPROVAL_TASK": {
      const task = await prisma.approvalTask.findUniqueOrThrow({ where: { id: targetId }, include: { step: { include: { instance: true } } } });
      if (task.step.instance.subjectType !== "CONTRACT") throw deny();
      const contract = await prisma.contractRecord.findUniqueOrThrow({ where: { id: task.step.instance.subjectId }, select: { documentId: true } });
      await check(contract.documentId, "document.approve");
      return contract.documentId;
    }
  }
}

/** Kalemi devreder. Alıcı aktif olmalı ve kaynak için yetkili olmalıdır. Önceki sahip ve alıcı denetime yazılır. */
export async function transferOffboardingItem(
  prisma: PrismaClient,
  input: { actor: ActorContext; now: Date; correlationId: string; caseId: string; itemId: string; toUserId: string; expectedRowVersion: number },
): Promise<void> {
  requireGlobal(input.actor, "user.manage", input.now);
  const { c, item } = await loadCaseAndItem(prisma, input.caseId, input.itemId);
  if (c.status !== "OPEN") throw new DomainError("OFFBOARDING_STATE_INVALID", "Ayrılış dosyası açık değil");
  if (item.status !== "OPEN") throw new DomainError("OFFBOARDING_STATE_INVALID", "Kalem zaten kapatılmış");
  if (item.rowVersion !== input.expectedRowVersion) throw new DomainError("VERSION_CONFLICT");
  if (input.toUserId === c.userId) throw new DomainError("OFFBOARDING_STATE_INVALID", "Sorumluluk ayrılan kişiye devredilemez");

  const recipient = await loadActorContext(prisma, input.toUserId, input.now);
  if (recipient.status !== "ACTIVE") throw new DomainError("OFFBOARDING_STATE_INVALID", "Devir alıcısı aktif değil");

  try {
    await assertRecipientCanHold(prisma, recipient, input.now, item.kind, item.targetId, item.field);
  } catch (err) {
    await recordDenied(prisma, { actorId: input.actor.userId, eventType: "OFFBOARDING_TRANSFER_DENIED", targetType: "USER", targetId: c.userId, reason: "RECIPIENT_NOT_AUTHORIZED", correlationId: input.correlationId });
    throw err;
  }

  await prisma.$transaction(async (tx) => {
    let applied = 0;
    switch (item.kind) {
      case "DOCUMENT_OWNER":
        applied = (await tx.document.updateMany({ where: { id: item.targetId, ownerId: c.userId }, data: { ownerId: input.toUserId, rowVersion: { increment: 1 }, updatedBy: input.actor.userId } })).count;
        break;
      case "CONTRACT_ROLE": {
        const f = item.field as ContractField;
        if (!(CONTRACT_FIELDS as readonly string[]).includes(f)) throw new DomainError("OFFBOARDING_STATE_INVALID");
        const where = { id: item.targetId, [f]: c.userId };
        const data = { [f]: input.toUserId };
        applied = (await tx.contractRecord.updateMany({ where, data })).count;
        break;
      }
      case "OBLIGATION_RESPONSIBLE":
        applied = (await tx.obligation.updateMany({ where: { id: item.targetId, responsibleUserId: c.userId }, data: { responsibleUserId: input.toUserId } })).count;
        break;
      case "APPROVAL_TASK":
        applied = (await tx.approvalTask.updateMany({ where: { id: item.targetId, assigneeId: c.userId, status: "PENDING" }, data: { assigneeId: input.toUserId } })).count;
        break;
    }
    if (applied !== 1) throw new DomainError("OFFBOARDING_STATE_INVALID", "Kaynak artık ayrılan kişiye ait değil");
    const upd = await tx.offboardingItem.updateMany({
      where: { id: item.id, rowVersion: input.expectedRowVersion, status: "OPEN" },
      data: { status: "TRANSFERRED", toUserId: input.toUserId, decidedById: input.actor.userId, decidedAt: input.now, rowVersion: { increment: 1 } },
    });
    if (upd.count !== 1) throw new DomainError("VERSION_CONFLICT");
    await appendAudit(tx, {
      actorType: "USER", actorId: input.actor.userId, eventType: "OFFBOARDING_ITEM_TRANSFERRED", targetType: "USER", targetId: c.userId,
      outcome: "SUCCESS", correlationId: input.correlationId,
      afterSummary: { caseId: c.id, itemId: item.id, kind: item.kind, targetId: item.targetId, field: item.field, fromUserId: c.userId, toUserId: input.toUserId },
    });
  });
}

/** Kalemi bilinçli olarak kapatır (yalnızca engellemeyen modda). Gerekçe zorunlu. */
export async function waiveOffboardingItem(
  prisma: PrismaClient,
  input: { actor: ActorContext; now: Date; correlationId: string; caseId: string; itemId: string; note: string; expectedRowVersion: number },
): Promise<void> {
  requireGlobal(input.actor, "user.manage", input.now);
  const { c, item } = await loadCaseAndItem(prisma, input.caseId, input.itemId);
  if (c.status !== "OPEN" || item.status !== "OPEN") throw new DomainError("OFFBOARDING_STATE_INVALID", "Kalem açık değil");
  if (c.blockOnUnresolved) throw new DomainError("OFFBOARDING_UNRESOLVED", "Engelleyici modda kalem bırakılamaz; sorumluluk devredilmelidir");
  const note = input.note.trim();
  if (!note) throw new DomainError("REASON_REQUIRED");
  if (item.rowVersion !== input.expectedRowVersion) throw new DomainError("VERSION_CONFLICT");
  await prisma.$transaction(async (tx) => {
    const upd = await tx.offboardingItem.updateMany({
      where: { id: item.id, rowVersion: input.expectedRowVersion, status: "OPEN" },
      data: { status: "WAIVED", note, decidedById: input.actor.userId, decidedAt: input.now, rowVersion: { increment: 1 } },
    });
    if (upd.count !== 1) throw new DomainError("VERSION_CONFLICT");
    await appendAudit(tx, {
      actorType: "USER", actorId: input.actor.userId, eventType: "OFFBOARDING_ITEM_WAIVED", targetType: "USER", targetId: c.userId,
      outcome: "SUCCESS", reason: note, correlationId: input.correlationId, afterSummary: { caseId: c.id, itemId: item.id, kind: item.kind },
    });
  });
}

/**
 * Ayrılışı tamamlar: hesap DISABLED olur. Engelleyici modda açık kalem varsa ENGEL (OFFBOARDING_UNRESOLVED).
 * Engellemeyen modda açık kalemler UYARI olarak denetime yazılır ve görünür kalır.
 */
export async function completeOffboarding(
  prisma: PrismaClient,
  input: { actor: ActorContext; now: Date; correlationId: string; caseId: string; expectedRowVersion: number },
): Promise<{ warning: boolean; openCount: number }> {
  requireGlobal(input.actor, "user.manage", input.now);
  const c = await prisma.offboardingCase.findUnique({ where: { id: input.caseId }, include: { items: true } });
  if (!c) throw new DomainError("NOT_FOUND");
  if (c.status !== "OPEN") throw new DomainError("OFFBOARDING_STATE_INVALID", "Ayrılış dosyası açık değil");
  if (c.rowVersion !== input.expectedRowVersion) throw new DomainError("VERSION_CONFLICT");
  const gate = canCompleteOffboarding({ blockOnUnresolved: c.blockOnUnresolved, items: c.items.map((i) => ({ status: i.status })) });
  if (!gate.ok) {
    await recordDenied(prisma, { actorId: input.actor.userId, eventType: "OFFBOARDING_COMPLETE_DENIED", targetType: "USER", targetId: c.userId, reason: `OPEN_ITEMS:${String(gate.openCount)}`, correlationId: input.correlationId });
    throw new DomainError("OFFBOARDING_UNRESOLVED", `Devredilmemiş ${String(gate.openCount)} sorumluluk var; hesap kapatılamaz`);
  }
  await prisma.$transaction(async (tx) => {
    const upd = await tx.offboardingCase.updateMany({
      where: { id: c.id, rowVersion: input.expectedRowVersion, status: "OPEN" },
      data: { status: "COMPLETED", completedById: input.actor.userId, completedAt: input.now, rowVersion: { increment: 1 } },
    });
    if (upd.count !== 1) throw new DomainError("VERSION_CONFLICT");
    await tx.user.update({ where: { id: c.userId }, data: { status: "DISABLED", updatedBy: input.actor.userId } });
    await tx.authSession.updateMany({ where: { userId: c.userId, revokedAt: null }, data: { revokedAt: input.now } });
    await appendAudit(tx, {
      actorType: "USER", actorId: input.actor.userId, eventType: "OFFBOARDING_COMPLETED", targetType: "USER", targetId: c.userId,
      outcome: "SUCCESS", correlationId: input.correlationId,
      afterSummary: { caseId: c.id, warning: gate.warning, openCount: gate.openCount },
    });
  });
  return { warning: gate.warning, openCount: gate.openCount };
}

/** Ayrılış dosyası ve kalemleri (yetkili kullanıcı). */
export async function getOffboardingCase(prisma: PrismaClient, input: { actor: ActorContext; now: Date; caseId: string }) {
  requireGlobal(input.actor, "user.manage", input.now);
  const c = await prisma.offboardingCase.findUnique({ where: { id: input.caseId }, include: { items: { orderBy: { createdAt: "asc" } } } });
  if (!c) throw new DomainError("NOT_FOUND");
  return c;
}


/** Ayrılış dosyası listesi (user.manage). Durum filtresi isteğe bağlıdır. */
export async function listOffboardingCases(
  prisma: PrismaClient,
  input: { actor: ActorContext; now: Date; status?: "OPEN" | "COMPLETED" | "CANCELLED" | null },
) {
  requireGlobal(input.actor, "user.manage", input.now);
  const rows = await prisma.offboardingCase.findMany({
    where: input.status ? { status: input.status } : {},
    orderBy: { openedAt: "desc" },
    take: 200,
    include: { user: { select: { displayName: true, email: true, status: true } }, items: { select: { status: true } } },
  });
  return rows.map((c) => ({
    id: c.id,
    userId: c.userId,
    userDisplayName: c.user.displayName,
    userEmail: c.user.email,
    userStatus: c.user.status,
    status: c.status,
    reason: c.reason,
    blockOnUnresolved: c.blockOnUnresolved,
    openedAt: c.openedAt,
    completedAt: c.completedAt,
    cancelledAt: c.cancelledAt,
    openItemCount: c.items.filter((i) => i.status === "OPEN").length,
    itemCount: c.items.length,
    rowVersion: c.rowVersion,
  }));
}

/**
 * Ayrılış dosyasını iptal eder (ör. yanlış hesap veya çalışan kurumda kalıyor).
 * Hesap ACTIVE'e döner; oturum kapatma geri alınmaz (kullanıcı yeniden giriş yapar). Mevcut kalemler ve devirler
 * değiştirilmez (geçmiş silinmez); açık kalemler yalnızca "vaka iptal edildi" olarak kalır.
 */
export async function cancelOffboardingCase(
  prisma: PrismaClient,
  input: { actor: ActorContext; now: Date; correlationId: string; caseId: string; reason: string; expectedRowVersion: number },
): Promise<void> {
  requireGlobal(input.actor, "user.manage", input.now);
  const reason = input.reason.trim();
  if (!reason) throw new DomainError("REASON_REQUIRED");
  await prisma.$transaction(async (tx) => {
    const c = await tx.offboardingCase.findUnique({ where: { id: input.caseId } });
    if (!c) throw new DomainError("NOT_FOUND");
    if (c.status !== "OPEN") throw new DomainError("OFFBOARDING_STATE_INVALID", "Yalnızca açık ayrılış dosyası iptal edilebilir");
    if (c.rowVersion !== input.expectedRowVersion) throw new DomainError("VERSION_CONFLICT");
    const upd = await tx.offboardingCase.updateMany({
      where: { id: c.id, rowVersion: input.expectedRowVersion, status: "OPEN" },
      data: { status: "CANCELLED", cancelledById: input.actor.userId, cancelledAt: input.now, cancelReason: reason, rowVersion: { increment: 1 } },
    });
    if (upd.count !== 1) throw new DomainError("VERSION_CONFLICT");
    await tx.user.updateMany({ where: { id: c.userId, status: "OFFBOARDING" }, data: { status: "ACTIVE", updatedBy: input.actor.userId } });
    await appendAudit(tx, {
      actorType: "USER", actorId: input.actor.userId, eventType: "OFFBOARDING_CANCELLED", targetType: "USER", targetId: c.userId,
      outcome: "SUCCESS", reason, correlationId: input.correlationId, afterSummary: { caseId: c.id },
    });
  });
}

/** Kullanıcı seçici (user.manage): yalnızca ACTIVE hesaplar; ad veya e-posta ile arama. En çok 20 sonuç. */
export async function searchActiveUsers(prisma: PrismaClient, input: { actor: ActorContext; now: Date; q: string }) {
  requireGlobal(input.actor, "user.manage", input.now);
  const q = input.q.trim().slice(0, 100);
  const rows = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      ...(q ? { OR: [{ displayName: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : {}),
    },
    orderBy: { displayName: "asc" },
    take: 20,
    select: { id: true, displayName: true, email: true },
  });
  return rows;
}
