// Görevler / onaylar (Faz 5, madde 4): atanan görevler, vekalet (delegasyon), SLA durumu.
// Görev listesi yalnız gerçek ApprovalTask kayıtlarından gelir; teslim (bildirim) durumundan bağımsızdır.
import { type PrismaClient } from "@prisma/client";
import { uuidv7, type ActorContext } from "@ekos/core";
import { appendAudit } from "../audit.js";
import { DomainError } from "../documents/shared.js";
import { documentVisibilitySql } from "../documents/visibility.js";
import { authorize } from "@ekos/core";

export type SlaStatus = "NO_SLA" | "ON_TIME" | "DUE_SOON" | "OVERDUE";
export const DUE_SOON_MS = 48 * 60 * 60 * 1000;

export function slaStatus(dueAt: Date | null, now: Date): SlaStatus {
  if (!dueAt) return "NO_SLA";
  const diff = dueAt.getTime() - now.getTime();
  if (diff < 0) return "OVERDUE";
  if (diff <= DUE_SOON_MS) return "DUE_SOON";
  return "ON_TIME";
}

export const DELEGATION_MAX_DAYS = 90;
export const DELEGATION_SCOPE = { approval: true } as const;

export interface TaskRow {
  id: string;
  stepId: string;
  assigneeId: string;
  assigneeName: string;
  status: string;
  dueAt: Date | null;
  sla: SlaStatus;
  viaDelegationFrom: string | null;
  subjectType: string;
  subjectId: string;
  subjectTitle: string;
  rowVersion: number;
}

/** Aktif vekaletler: bu kullanıcıya (delegate) devredilen onay yetkisi. */
export async function activeDelegatorsOf(prisma: PrismaClient, delegateId: string, now: Date): Promise<string[]> {
  const rows = await prisma.delegation.findMany({
    where: { delegateId, revokedAt: null, startsAt: { lte: now }, endsAt: { gt: now } },
    select: { delegatorId: true, scope: true },
  });
  return rows.filter((r) => (r.scope as { approval?: unknown } | null)?.approval === true).map((r) => r.delegatorId);
}

/**
 * Kullanıcının bekleyen onay görevleri: kendisine atanan + aktif vekaletle devredilen.
 * Sözleşme konusu görevlerde belge GÖRÜNÜRLÜĞÜ şarttır (kendi atamasında da — ACL değişmişse gizlenir).
 */
export async function listMyTasks(prisma: PrismaClient, input: { actor: ActorContext; now: Date }): Promise<TaskRow[]> {
  const delegators = await activeDelegatorsOf(prisma, input.actor.userId, input.now);
  const tasks = await prisma.approvalTask.findMany({
    where: {
      status: "PENDING",
      OR: [{ assigneeId: input.actor.userId }, ...(delegators.length ? [{ assigneeId: { in: delegators } }] : [])],
    },
    include: { step: { include: { instance: true } }, assignee: { select: { displayName: true } } },
    orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
    take: 500,
  });
  const contractIds = tasks.filter((t) => t.step.instance.subjectType === "CONTRACT").map((t) => t.step.instance.subjectId);
  const contracts = contractIds.length
    ? await prisma.contractRecord.findMany({ where: { id: { in: contractIds } }, select: { id: true, documentId: true, title: true } })
    : [];
  const visibleDocs = contracts.length
    ? new Set((await prisma.$queryRaw<{ id: string }[]>`
        SELECT d."id" FROM "Document" d
        WHERE d."id" = ANY(${contracts.map((c) => c.documentId)}::uuid[]) AND ${documentVisibilitySql(input.actor, input.now)}`).map((r) => r.id))
    : new Set<string>();
  const byContract = new Map(contracts.map((c) => [c.id, c]));

  const out: TaskRow[] = [];
  for (const t of tasks) {
    const inst = t.step.instance;
    const contract = inst.subjectType === "CONTRACT" ? byContract.get(inst.subjectId) : undefined;
    const own = t.assigneeId === input.actor.userId;
    if (contract && !own && !visibleDocs.has(contract.documentId)) continue;
    out.push({
      id: t.id,
      stepId: t.stepId,
      assigneeId: t.assigneeId,
      assigneeName: t.assignee.displayName,
      status: t.status,
      dueAt: t.dueAt,
      sla: slaStatus(t.dueAt, input.now),
      viaDelegationFrom: own ? null : t.assigneeId,
      subjectType: inst.subjectType,
      subjectId: inst.subjectId,
      subjectTitle: contract && visibleDocs.has(contract.documentId) ? contract.title : "Gizli kayıt",
      rowVersion: t.rowVersion,
    });
  }
  return out;
}

export interface DelegationView {
  id: string;
  delegatorId: string;
  delegatorName: string;
  delegateId: string;
  delegateName: string;
  reason: string;
  startsAt: Date;
  endsAt: Date;
  revokedAt: Date | null;
  rowVersion: number;
  state: "ACTIVE" | "SCHEDULED" | "EXPIRED" | "REVOKED";
}

export async function listDelegations(prisma: PrismaClient, input: { actor: ActorContext; now: Date }): Promise<DelegationView[]> {
  const rows = await prisma.delegation.findMany({
    where: { OR: [{ delegatorId: input.actor.userId }, { delegateId: input.actor.userId }] },
    include: { delegator: { select: { displayName: true } }, delegate: { select: { displayName: true } } },
    orderBy: { startsAt: "desc" },
    take: 200,
  });
  return rows.map((r) => ({
    id: r.id,
    delegatorId: r.delegatorId,
    delegatorName: r.delegator.displayName,
    delegateId: r.delegateId,
    delegateName: r.delegate.displayName,
    reason: r.reason,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    revokedAt: r.revokedAt,
    rowVersion: r.rowVersion,
    state: r.revokedAt ? "REVOKED" : r.endsAt <= input.now ? "EXPIRED" : r.startsAt > input.now ? "SCHEDULED" : "ACTIVE",
  }));
}

export async function createDelegation(
  prisma: PrismaClient,
  input: { actor: ActorContext; now: Date; correlationId: string; delegateId: string; startsAt: Date; endsAt: Date; reason: string },
): Promise<{ id: string }> {
  const reason = input.reason.trim();
  if (!reason) throw new DomainError("REASON_REQUIRED", "Vekalet gerekçesi zorunludur");
  if (input.delegateId === input.actor.userId) throw new DomainError("VALIDATION_FAILED", "Kendinize vekalet verilemez");
  if (!(input.endsAt > input.startsAt)) throw new DomainError("VALIDATION_FAILED", "Bitiş, başlangıçtan sonra olmalı");
  if (input.endsAt.getTime() <= input.now.getTime()) throw new DomainError("VALIDATION_FAILED", "Bitiş geçmişte olamaz");
  if (input.endsAt.getTime() - input.startsAt.getTime() > DELEGATION_MAX_DAYS * 86_400_000) {
    throw new DomainError("VALIDATION_FAILED", `Vekalet en fazla ${String(DELEGATION_MAX_DAYS)} gün olabilir`);
  }
  if (input.actor.status !== "ACTIVE") throw new DomainError("FORBIDDEN", "Hesap aktif değil");
  return prisma.$transaction(async (tx) => {
    const delegate = await tx.user.findUnique({ where: { id: input.delegateId }, select: { status: true } });
    if (!delegate || delegate.status !== "ACTIVE") throw new DomainError("VALIDATION_FAILED", "Vekil aktif bir kullanıcı olmalı");
    const id = uuidv7();
    await tx.delegation.create({
      data: {
        id,
        delegatorId: input.actor.userId,
        delegateId: input.delegateId,
        scope: { ...DELEGATION_SCOPE },
        reason: reason.slice(0, 1000),
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        createdBy: input.actor.userId,
        updatedBy: input.actor.userId,
      },
    });
    await appendAudit(tx, {
      actorType: "USER", actorId: input.actor.userId, eventType: "DELEGATION_CREATED", targetType: "DELEGATION", targetId: id,
      outcome: "SUCCESS", reason, correlationId: input.correlationId,
      afterSummary: { delegateId: input.delegateId, startsAt: input.startsAt.toISOString(), endsAt: input.endsAt.toISOString(), scope: "approval" },
    });
    return { id };
  });
}

export async function revokeDelegation(
  prisma: PrismaClient,
  input: { actor: ActorContext; now: Date; correlationId: string; delegationId: string; expectedRowVersion: number },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const d = await tx.delegation.findUnique({ where: { id: input.delegationId } });
    if (!d) throw new DomainError("NOT_FOUND");
    const isAdmin = authorize({ actor: input.actor, permission: "user.manage", now: input.now }).allowed;
    if (d.delegatorId !== input.actor.userId && !isAdmin) throw new DomainError("FORBIDDEN", "Yalnızca vekalet veren iptal edebilir");
    if (d.revokedAt) throw new DomainError("VALIDATION_FAILED", "Vekalet zaten iptal edilmiş");
    if (d.rowVersion !== input.expectedRowVersion) throw new DomainError("VERSION_CONFLICT");
    await tx.delegation.update({
      where: { id: d.id },
      data: { revokedAt: input.now, rowVersion: { increment: 1 }, updatedBy: input.actor.userId },
    });
    await appendAudit(tx, {
      actorType: "USER", actorId: input.actor.userId, eventType: "DELEGATION_REVOKED", targetType: "DELEGATION", targetId: d.id,
      outcome: "SUCCESS", correlationId: input.correlationId, afterSummary: { delegateId: d.delegateId },
    });
  });
}
