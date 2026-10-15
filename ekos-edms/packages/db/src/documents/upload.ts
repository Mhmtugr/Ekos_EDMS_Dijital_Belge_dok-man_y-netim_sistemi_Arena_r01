// Yükleme ve tarama (Faz 2, madde 2). Dosya önce karantinaya yazılır; tarama CLEAN dönmeden objects/ alanına çıkmaz.
import { createHash, randomUUID } from "node:crypto";
import { checkUpload, type AntivirusPort, type ObjectStoragePort, uuidv7, type UploadIssue } from "@ekos/core";
import type { PrismaClient } from "@prisma/client";
import { appendAudit } from "../audit.js";
import { onScanVerdict } from "./pipeline.js";
import { activateSignedContractForFileInTx } from "../contracts/lifecycle.js";
import { DomainError } from "./shared.js";

export interface UploadDeps {
  readonly prisma: PrismaClient;
  readonly storage: ObjectStoragePort;
}

export interface UploadInput {
  readonly actorId: string;
  readonly correlationId: string;
  readonly filename: string;
  readonly declaredMime: string;
  readonly bytes: Uint8Array;
  readonly maxBytes: number;
}

export type UploadResult =
  | { readonly status: "QUARANTINED"; readonly fileObjectId: string; readonly sha256: string }
  | { readonly status: "REJECTED"; readonly issues: readonly UploadIssue[] };

export function sha256OfBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function registerUpload(deps: UploadDeps, input: UploadInput): Promise<UploadResult> {
  const check = checkUpload({
    filename: input.filename,
    declaredMime: input.declaredMime,
    sizeBytes: input.bytes.length,
    head: input.bytes.subarray(0, 16),
    maxBytes: input.maxBytes,
  });
  if (!check.ok) {
    await deps.prisma.$transaction((tx) =>
      appendAudit(tx, {
        actorType: "USER",
        actorId: input.actorId,
        eventType: "FILE_UPLOAD_REJECTED",
        targetType: "DocumentFileObject",
        targetId: null,
        outcome: "DENIED",
        reason: check.issues.join(","),
        correlationId: input.correlationId,
        afterSummary: { filenameLength: input.filename.length, sizeBytes: input.bytes.length },
      }),
    );
    return { status: "REJECTED", issues: check.issues };
  }

  const sha256 = sha256OfBytes(input.bytes);
  const storageKey = `quarantine/${randomUUID()}`;
  await deps.storage.put(storageKey, input.bytes);
  const fileObjectId = uuidv7();
  await deps.prisma.$transaction(async (tx) => {
    await tx.documentFileObject.create({
      data: {
        id: fileObjectId,
        storageKey,
        storagePrefix: "quarantine",
        originalFileName: input.filename,
        mimeType: input.declaredMime,
        byteSize: BigInt(input.bytes.length),
        sha256,
        scanStatus: "PENDING",
        createdBy: input.actorId,
      },
    });
    await appendAudit(tx, {
      actorType: "USER",
      actorId: input.actorId,
      eventType: "FILE_RECEIVED",
      targetType: "DocumentFileObject",
      targetId: fileObjectId,
      outcome: "SUCCESS",
      correlationId: input.correlationId,
      afterSummary: { sha256, sizeBytes: input.bytes.length, detected: check.detected },
    });
  });
  return { status: "QUARANTINED", fileObjectId, sha256 };
}

export interface ScanDeps extends UploadDeps {
  readonly av: AntivirusPort;
}

export type ScanResult =
  | { readonly status: "CLEAN" }
  | { readonly status: "INFECTED"; readonly signature: string }
  | { readonly status: "UNAVAILABLE" };

/**
 * Tarama: yalnızca bir kez kesin karar verir (CLEAN/INFECTED). UNAVAILABLE karar değildir: dosya karantinada kalır.
 * Bütünlük: depodaki baytların hash'i kayıtla eşleşmezse tarama yapılmaz.
 */
export async function scanFile(
  deps: ScanDeps,
  input: { readonly fileObjectId: string; readonly actorId: string | null; readonly correlationId: string },
): Promise<ScanResult> {
  const file = await deps.prisma.documentFileObject.findUnique({ where: { id: input.fileObjectId } });
  if (!file) throw new DomainError("NOT_FOUND");
  if (file.scanStatus === "CLEAN") return { status: "CLEAN" };
  if (file.scanStatus === "INFECTED") return { status: "INFECTED", signature: "(önceki karar)" };

  const bytes = await deps.storage.get(file.storageKey);
  if (sha256OfBytes(bytes) !== file.sha256) {
    await deps.prisma.$transaction((tx) =>
      appendAudit(tx, {
        actorType: "SYSTEM",
        actorId: null,
        eventType: "FILE_INTEGRITY_MISMATCH",
        targetType: "DocumentFileObject",
        targetId: file.id,
        outcome: "FAILED",
        correlationId: input.correlationId,
      }),
    );
    throw new DomainError("INTEGRITY_MISMATCH");
  }

  const verdict = await deps.av.scan(bytes);
  const now = new Date();

  if (verdict.status === "CLEAN") {
    const newKey = `objects/${file.storageKey.slice("quarantine/".length)}`;
    await deps.storage.move(file.storageKey, newKey);
    try {
      await deps.prisma.$transaction(async (tx) => {
        await tx.documentFileObject.update({
          where: { id: file.id },
          data: { scanStatus: "CLEAN", scannedAt: now, storagePrefix: "objects", storageKey: newKey },
        });
        await onScanVerdict(tx, file.id, "CLEAN");
        // İmzalı sürüm taraması: e-imza kanıtı varsa sözleşme bu noktada ACTIVE olur (R-LC-04).
        await activateSignedContractForFileInTx(tx, file.id, input.correlationId);
        await appendAudit(tx, scanAudit(file.id, "CLEAN", input));
      });
    } catch (err) {
      // Veritabanı yazımı başarısızsa dosyayı karantinaya geri taşı: depo ve kayıt tutarlı kalır.
      await deps.storage.move(newKey, file.storageKey).catch(() => undefined);
      throw err;
    }
    return { status: "CLEAN" };
  }

  if (verdict.status === "INFECTED") {
    await deps.prisma.$transaction(async (tx) => {
      await tx.documentFileObject.update({ where: { id: file.id }, data: { scanStatus: "INFECTED", scannedAt: now } });
      await onScanVerdict(tx, file.id, "INFECTED");
      await appendAudit(tx, scanAudit(file.id, "INFECTED", input, verdict.signature));
    });
    return { status: "INFECTED", signature: verdict.signature };
  }

  // UNAVAILABLE: tarama servisi kapalı/belirsiz. Karar kaydedilmez; dosya karantinada, belge READY olmaz.
  await deps.prisma.$transaction(async (tx) => {
    await tx.documentFileObject.update({ where: { id: file.id }, data: { scanStatus: "UNAVAILABLE" } });
    await onScanVerdict(tx, file.id, "UNAVAILABLE");
    await appendAudit(tx, scanAudit(file.id, "UNAVAILABLE", input, verdict.reason));
  });
  return { status: "UNAVAILABLE" };
}

function scanAudit(
  fileId: string,
  outcome: "CLEAN" | "INFECTED" | "UNAVAILABLE",
  input: { actorId: string | null; correlationId: string },
  detail?: string,
) {
  return {
    actorType: input.actorId ? ("USER" as const) : ("SYSTEM" as const),
    actorId: input.actorId,
    eventType: `FILE_SCAN_${outcome}`,
    targetType: "DocumentFileObject",
    targetId: fileId,
    outcome: outcome === "UNAVAILABLE" ? ("FAILED" as const) : ("SUCCESS" as const),
    reason: detail ?? null,
    correlationId: input.correlationId,
    afterSummary: { scanStatus: outcome },
  };
}
