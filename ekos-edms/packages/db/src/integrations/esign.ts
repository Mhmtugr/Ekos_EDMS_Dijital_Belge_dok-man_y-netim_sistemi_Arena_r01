// E-imza: dış işlem kimliği ↔ iç kayıt bağı ve tamamlanma kanıtı (Faz 6 madde 2).
// Denetime taraf e-postaları/adları YAZILMAZ; yalnız sayı, zaman ve imzalı dosyanın SHA-256 özeti yazılır.
import { randomUUID } from "node:crypto";
import type { ObjectStoragePort } from "@ekos/core";
import type { PrismaClient } from "@prisma/client";
import { appendAudit } from "../audit.js";
import { attachSignedVersionInTx, activateSignedContractInTx } from "../contracts/lifecycle.js";
import { DomainError } from "../documents/shared.js";

export const ESIGN_SOURCE = "esignature";

export async function linkExternalRecord(
  prisma: PrismaClient,
  input: { readonly sourceSystem: string; readonly externalId: string; readonly entityType: string; readonly entityId: string; readonly requestedById: string | null },
): Promise<void> {
  await prisma.externalRecordRef.upsert({
    where: { sourceSystem_externalId: { sourceSystem: input.sourceSystem, externalId: input.externalId } },
    create: { ...input, lastSyncedAt: new Date() },
    update: { lastSyncedAt: new Date() },
  });
}

export async function recordSignCompletion(
  prisma: PrismaClient,
  input: {
    readonly transactionId: string;
    readonly signedAt: Date;
    readonly partyCount: number;
    readonly signedFileSha256: string;
    readonly correlationId: string;
  },
): Promise<{ readonly status: "RECORDED"; readonly entityId: string } | { readonly status: "UNKNOWN_TRANSACTION" }> {
  const ref = await prisma.externalRecordRef.findUnique({
    where: { sourceSystem_externalId: { sourceSystem: ESIGN_SOURCE, externalId: input.transactionId } },
  });
  if (!ref) return { status: "UNKNOWN_TRANSACTION" };
  await prisma.$transaction(async (tx) => {
    await tx.externalRecordRef.update({ where: { id: ref.id }, data: { lastSyncedAt: new Date() } });
    await appendAudit(tx, {
      actorType: "SYSTEM",
      actorId: null,
      eventType: "esign.completed",
      targetType: ref.entityType,
      targetId: ref.entityId,
      outcome: "SUCCESS",
      correlationId: input.correlationId,
      afterSummary: {
        transactionId: input.transactionId,
        signedAt: input.signedAt.toISOString(),
        partyCount: input.partyCount,
        signedFileSha256: input.signedFileSha256,
      },
    });
  });
  return { status: "RECORDED", entityId: ref.entityId };
}

export interface RecordSignedVersionInput {
  readonly transactionId: string;
  readonly signedAt: Date;
  readonly parties: readonly { readonly name: string }[];
  /** Doğrulanmış (SHA-256 eşleşmiş) imzalı dosya baytları. */
  readonly signedFile: Uint8Array;
  readonly signedFileSha256: string;
  readonly correlationId: string;
}

export type RecordSignedVersionResult =
  | { readonly status: "UNKNOWN_TRANSACTION" }
  | {
      readonly status: "RECORDED";
      readonly entityId: string;
      readonly versionNumber: number;
      readonly fileObjectId: string | null;
      /** DUPLICATE: aynı imzalı dosya daha önce kaydedilmişti; yeni sürüm üretilmedi. */
      readonly duplicate: boolean;
      /** Sözleşme bu çağrıda ACTIVE oldu mu (yalnız dosya zaten CLEAN ise olmaz; normalde tarama sonrası olur). */
      readonly activated: boolean;
    };

/**
 * E-imza tamamlanma olayını kalıcılaştırır: imzalı dosya karantinaya yazılır, belgeye imzalı sürüm eklenir,
 * kanıt kaydı aynı işlemde yazılır. Sözleşme yalnız tarama CLEAN olduğunda ACTIVE olur.
 */
export async function recordSignedVersion(
  prisma: PrismaClient,
  storage: ObjectStoragePort,
  input: RecordSignedVersionInput,
): Promise<RecordSignedVersionResult> {
  const ref = await prisma.externalRecordRef.findUnique({
    where: { sourceSystem_externalId: { sourceSystem: ESIGN_SOURCE, externalId: input.transactionId } },
  });
  if (!ref) return { status: "UNKNOWN_TRANSACTION" };
  if (ref.entityType !== "Document") throw new DomainError("NOT_FOUND", "İmza işlemi bir sözleşmeye bağlı değil");
  if (!ref.requestedById) throw new DomainError("VALIDATION_FAILED", "İmza talebini başlatan kullanıcı kaydı yok");

  const storageKey = `quarantine/${randomUUID()}`;
  await storage.put(storageKey, input.signedFile);
  let result: { attached: Awaited<ReturnType<typeof attachSignedVersionInTx>>; activated: boolean };
  try {
    result = await prisma.$transaction(async (tx) => {
      const attached = await attachSignedVersionInTx(tx, {
        documentId: ref.entityId,
        actorId: ref.requestedById as string,
        correlationId: input.correlationId,
        transactionId: input.transactionId,
        signedAt: input.signedAt,
        signerNames: input.parties.map((p) => p.name),
        signedFileSha256: input.signedFileSha256,
        storageKey,
        originalFileName: "imzali-sozlesme.pdf",
        byteSize: input.signedFile.length,
      });
      await tx.externalRecordRef.update({ where: { id: ref.id }, data: { lastSyncedAt: new Date() } });
      await appendAudit(tx, {
        actorType: "SYSTEM",
        actorId: null,
        eventType: "esign.completed",
        targetType: "Document",
        targetId: ref.entityId,
        targetVersion: attached.versionNumber,
        outcome: "SUCCESS",
        correlationId: input.correlationId,
        afterSummary: {
          transactionId: input.transactionId,
          signedAt: input.signedAt.toISOString(),
          partyCount: input.parties.length,
          signedFileSha256: input.signedFileSha256,
          duplicate: attached.status === "DUPLICATE",
        },
      });
      const activated = attached.status === "CREATED" ? await activateSignedContractInTx(tx, ref.entityId, input.correlationId) : false;
      return { attached, activated };
    });
  } catch (err) {
    await storage.delete(storageKey).catch(() => undefined);
    throw err;
  }
  const { attached, activated } = result;
  if (attached.status === "DUPLICATE") await storage.delete(storageKey).catch(() => undefined);
  return {
    status: "RECORDED",
    entityId: ref.entityId,
    versionNumber: attached.versionNumber,
    fileObjectId: attached.fileObjectId,
    duplicate: attached.status === "DUPLICATE",
    activated,
  };
}
