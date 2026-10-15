// Hukuki bekletme (Faz 4, madde 2). Kapsam: kayıt + ilişkili tüm sürümler + dosya nesneleri + OCR işleri + çıkarımlar.
// Bekletme varken imha ve silme engellidir (uygulama kontrolü + veritabanı tetikleyicisi). Her işlem denetime yazılır.
import { uuidv7, type ActorContext } from "@ekos/core";
import type { Prisma, PrismaClient } from "@prisma/client";
import { guardDocument } from "../documents/guard.js";
import { DomainError } from "../documents/shared.js";
import { recordDenied } from "./common.js";
import { appendAudit } from "../audit.js";

export interface HoldScope {
  readonly versionIds: readonly string[];
  readonly fileObjectIds: readonly string[];
  readonly ocrJobCount: number;
  readonly extractionCount: number;
}

async function computeScope(tx: Prisma.TransactionClient, documentId: string): Promise<HoldScope> {
  const versions = await tx.documentVersion.findMany({ where: { documentId }, select: { id: true, fileObjectId: true } });
  const fileObjectIds = versions.map((v) => v.fileObjectId).filter((x): x is string => x !== null);
  const ocrJobCount = fileObjectIds.length ? await tx.oCRJob.count({ where: { fileObjectId: { in: fileObjectIds } } }) : 0;
  const extractionCount = await tx.extractionResult.count({ where: { documentId } });
  return { versionIds: versions.map((v) => v.id), fileObjectIds, ocrJobCount, extractionCount };
}

/** Bekletme koy. Yetki: document.legal_hold (belge görünür olmalı). Gerekçe zorunlu. */
export async function placeLegalHold(
  prisma: PrismaClient,
  input: { actor: ActorContext; now: Date; correlationId: string; documentId: string; reason: string; scopeNote?: string | null },
): Promise<{ holdId: string; scope: HoldScope }> {
  try {
    await guardDocument(prisma, { actor: input.actor, now: input.now, documentId: input.documentId, permission: "document.legal_hold" });
  } catch (err) {
    if (err instanceof DomainError) {
      await recordDenied(prisma, { actorId: input.actor.userId, eventType: "LEGAL_HOLD_PLACE_DENIED", targetType: "DOCUMENT", targetId: input.documentId, reason: err.code === "NOT_FOUND" ? "NOT_VISIBLE" : "NO_PERMISSION", correlationId: input.correlationId });
    }
    throw err;
  }
  const reason = input.reason.trim();
  if (!reason) throw new DomainError("REASON_REQUIRED");
  const holdId = uuidv7();
  return prisma.$transaction(async (tx) => {
    // Belge satırı kilitlenir: imha yürütücüsüyle yarış olmaz.
    await tx.$queryRaw`SELECT "id" FROM "Document" WHERE "id" = ${input.documentId}::uuid FOR UPDATE`;
    const doc = await tx.document.findUniqueOrThrow({ where: { id: input.documentId }, select: { id: true, generalStatus: true, number: true } });
    if (doc.generalStatus === "DISPOSED") throw new DomainError("DOCUMENT_DISPOSED");
    const scope = await computeScope(tx, doc.id);
    await tx.legalHold.create({
      data: {
        id: holdId,
        documentId: doc.id,
        reason,
        scopeNote: input.scopeNote?.trim() || `Kapsam: kayıt ${doc.number}, ${String(scope.versionIds.length)} sürüm, ${String(scope.fileObjectIds.length)} dosya nesnesi, ${String(scope.ocrJobCount)} OCR işi, ${String(scope.extractionCount)} çıkarım`,
        placedById: input.actor.userId,
      },
    });
    await tx.document.update({ where: { id: doc.id }, data: { legalHoldActive: true, rowVersion: { increment: 1 }, updatedBy: input.actor.userId } });
    await appendAudit(tx, {
      actorType: "USER", actorId: input.actor.userId, eventType: "LEGAL_HOLD_PLACED", targetType: "DOCUMENT", targetId: doc.id,
      outcome: "SUCCESS", reason, correlationId: input.correlationId,
      afterSummary: { holdId, versionCount: scope.versionIds.length, fileObjectCount: scope.fileObjectIds.length, ocrJobCount: scope.ocrJobCount, extractionCount: scope.extractionCount },
    });
    return { holdId, scope };
  });
}

/** Bekletmeyi kaldır. Gerekçe zorunlu. Başka aktif bekletme yoksa belge bayrağı temizlenir. Yetki: document.legal_hold. */
export async function releaseLegalHold(
  prisma: PrismaClient,
  input: { actor: ActorContext; now: Date; correlationId: string; holdId: string; reason: string },
): Promise<{ remainingActiveHolds: number }> {
  const hold = await prisma.legalHold.findUnique({ where: { id: input.holdId } });
  if (!hold) throw new DomainError("NOT_FOUND");
  try {
    await guardDocument(prisma, { actor: input.actor, now: input.now, documentId: hold.documentId, permission: "document.legal_hold" });
  } catch (err) {
    if (err instanceof DomainError) {
      await recordDenied(prisma, { actorId: input.actor.userId, eventType: "LEGAL_HOLD_RELEASE_DENIED", targetType: "DOCUMENT", targetId: hold.documentId, reason: err.code === "NOT_FOUND" ? "NOT_VISIBLE" : "NO_PERMISSION", correlationId: input.correlationId });
    }
    throw err;
  }
  const reason = input.reason.trim();
  if (!reason) throw new DomainError("REASON_REQUIRED");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Document" WHERE "id" = ${hold.documentId}::uuid FOR UPDATE`;
    const upd = await tx.legalHold.updateMany({
      where: { id: hold.id, releasedAt: null },
      data: { releasedAt: input.now, releasedById: input.actor.userId, releaseReason: reason, rowVersion: { increment: 1 } },
    });
    if (upd.count !== 1) throw new DomainError("DISPOSAL_STATE_INVALID", "Bekletme zaten kaldırılmış");
    const remaining = await tx.legalHold.count({ where: { documentId: hold.documentId, releasedAt: null } });
    await tx.document.update({
      where: { id: hold.documentId },
      data: { legalHoldActive: remaining > 0, rowVersion: { increment: 1 }, updatedBy: input.actor.userId },
    });
    await appendAudit(tx, {
      actorType: "USER", actorId: input.actor.userId, eventType: "LEGAL_HOLD_RELEASED", targetType: "DOCUMENT", targetId: hold.documentId,
      outcome: "SUCCESS", reason, correlationId: input.correlationId,
      beforeSummary: { holdId: hold.id, active: true }, afterSummary: { holdId: hold.id, active: false, remainingActiveHolds: remaining },
    });
    return { remainingActiveHolds: remaining };
  });
}

/** Belgenin bekletme kayıtları (görünür belge). */
export async function listLegalHolds(prisma: PrismaClient, input: { actor: ActorContext; now: Date; documentId: string }) {
  await guardDocument(prisma, { actor: input.actor, now: input.now, documentId: input.documentId, permission: "document.view_metadata" });
  return prisma.legalHold.findMany({ where: { documentId: input.documentId }, orderBy: { placedAt: "asc" } });
}
