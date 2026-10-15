// Denetim izi yazıcısı (ADR-0007): tek artan sıra, önceki hash zinciri, kilit altında yazım.
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  GENESIS_HASH,
  computeAuditHash,
  verifyAuditChain,
  type ChainVerification,
  type StoredAuditEvent,
} from "@ekos/core";

// Sabit kilit anahtarı: yalnızca denetim zinciri yazımlarını serileştirir.
const AUDIT_LOCK_KEY = 7_741_001;

export interface AuditInput {
  readonly actorType: "USER" | "SYSTEM" | "WORKER" | "BREAK_GLASS";
  readonly actorId: string | null;
  readonly eventType: string;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly targetVersion?: number | null;
  readonly outcome: "SUCCESS" | "DENIED" | "FAILED";
  readonly reason?: string | null;
  readonly correlationId: string;
  readonly requestId?: string | null;
  /** Hassas değer içermez; önce/sonra ÖZETİ. */
  readonly beforeSummary?: Record<string, unknown> | null;
  readonly afterSummary?: Record<string, unknown> | null;
}

export async function appendAudit(tx: Prisma.TransactionClient, input: AuditInput): Promise<bigint> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_LOCK_KEY})`;
  const last = await tx.auditEvent.findFirst({ orderBy: { sequence: "desc" }, select: { sequence: true, hash: true } });
  const prevHash = last?.hash ?? GENESIS_HASH;
  const sequence = (last?.sequence ?? 0n) + 1n;
  const occurredAt = new Date();
  const hashInput = {
    sequence,
    occurredAt,
    actorType: input.actorType,
    actorId: input.actorId,
    eventType: input.eventType,
    targetType: input.targetType,
    targetId: input.targetId,
    targetVersion: input.targetVersion ?? null,
    outcome: input.outcome,
    reason: input.reason ?? null,
    correlationId: input.correlationId,
    requestId: input.requestId ?? null,
    beforeSummary: input.beforeSummary ?? null,
    afterSummary: input.afterSummary ?? null,
  };
  const hash = computeAuditHash(prevHash, hashInput);
  await tx.auditEvent.create({
    data: {
      sequence,
      occurredAt,
      actorType: input.actorType,
      actorId: input.actorId,
      eventType: input.eventType,
      targetType: input.targetType,
      targetId: input.targetId,
      targetVersion: input.targetVersion ?? null,
      outcome: input.outcome,
      reason: input.reason ?? null,
      correlationId: input.correlationId,
      requestId: input.requestId ?? null,
      beforeSummary: input.beforeSummary ? (input.beforeSummary as Prisma.InputJsonObject) : Prisma.DbNull,
      afterSummary: input.afterSummary ? (input.afterSummary as Prisma.InputJsonObject) : Prisma.DbNull,
      prevHash,
      hash,
    },
  });
  return sequence;
}

/** Tüm denetim tablosunu sıralı okuyup zinciri doğrular. */
export async function verifyAuditTable(prisma: PrismaClient): Promise<ChainVerification> {
  const rows = await prisma.auditEvent.findMany({ orderBy: { sequence: "asc" } });
  const events: StoredAuditEvent[] = rows.map((r) => ({
    sequence: r.sequence,
    occurredAt: r.occurredAt,
    actorType: r.actorType,
    actorId: r.actorId,
    eventType: r.eventType,
    targetType: r.targetType,
    targetId: r.targetId,
    targetVersion: r.targetVersion,
    outcome: r.outcome,
    reason: r.reason,
    correlationId: r.correlationId,
    requestId: r.requestId,
    beforeSummary: r.beforeSummary,
    afterSummary: r.afterSummary,
    prevHash: r.prevHash,
    hash: r.hash,
  }));
  return verifyAuditChain(events);
}
