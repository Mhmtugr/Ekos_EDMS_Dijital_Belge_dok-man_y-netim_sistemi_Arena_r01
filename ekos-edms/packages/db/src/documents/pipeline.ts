// Yükleme/işleme hattı: tarama sonucu, OCR kuyruğu ve ingest durum geçişleri.
// Her geçiş core transitionIngest üzerinden yapılır; geçersiz geçiş hata verir (sessiz düzeltme yok).
import { indexOcrChunks } from "../integrations/chunks.js";
import type { Prisma, PrismaClient } from "@prisma/client";
import { MAX_OCR_ATTEMPTS, transitionIngest, type IngestEvent, type IngestState } from "@ekos/core";
import type { OcrPort, ObjectStoragePort } from "@ekos/core";
import { DomainError, buildSearchText } from "./shared.js";

type Tx = Prisma.TransactionClient;

/** Dosyanın mevcut sürümünü kullanan belgeler (yalnızca geçerli sürüm). */
export async function documentsOnFile(tx: Tx, fileObjectId: string) {
  const versions = await tx.documentVersion.findMany({ where: { fileObjectId }, select: { id: true } });
  if (versions.length === 0) return [];
  return tx.document.findMany({
    where: { currentVersionId: { in: versions.map((v) => v.id) } },
    include: { type: true },
  });
}

export async function applyIngest(
  tx: Tx,
  doc: { id: string; ingestStatus: IngestState["status"] },
  event: IngestEvent,
  ocrAttempts = 0,
): Promise<IngestState["status"]> {
  const next = transitionIngest({ status: doc.ingestStatus, ocrAttempts }, event);
  if (next.status !== doc.ingestStatus) {
    await tx.document.update({ where: { id: doc.id }, data: { ingestStatus: next.status } });
  }
  return next.status;
}

/** Tarama kararını belgelere uygular (CLEAN → PROCESSING, INFECTED → REJECTED, UNAVAILABLE → değişmez). */
export async function onScanVerdict(tx: Tx, fileObjectId: string, verdict: "CLEAN" | "INFECTED" | "UNAVAILABLE") {
  const docs = await documentsOnFile(tx, fileObjectId);
  for (const doc of docs) {
    // Tarama kararı yalnızca karantinadaki belgeyi etkiler; ilerlemiş belge geri alınmaz.
    if (doc.ingestStatus !== "QUARANTINED") continue;
    if (verdict === "UNAVAILABLE") {
      await applyIngest(tx, doc, "SCAN_UNAVAILABLE");
      continue;
    }
    if (verdict === "INFECTED") {
      await applyIngest(tx, doc, "SCAN_INFECTED");
      continue;
    }
    // CLEAN
    await applyIngest(tx, doc, "SCAN_CLEAN");
    if (doc.type.ocrRequired) {
      await tx.oCRJob.create({
        data: { fileObjectId, status: "QUEUED", languages: "tur+eng", attempts: 0 },
      });
    } else {
      await applyIngest(tx, { id: doc.id, ingestStatus: "PROCESSING" }, "OCR_NOT_REQUIRED");
      await applyIngest(tx, { id: doc.id, ingestStatus: "METADATA_PENDING" }, "METADATA_COMPLETED");
    }
  }
}

/** Kuyruktan bir iş alır. SKIP LOCKED: eşzamanlı işçiler aynı işi almaz. attempts artırılır. */
export async function claimNextOcrJob(prisma: PrismaClient): Promise<{ id: string; fileObjectId: string; attempts: number; languages: string } | null> {
  const rows = await prisma.$queryRaw<{ id: string; fileObjectId: string; attempts: number; languages: string }[]>`
    UPDATE "OCRJob" SET "status" = 'PROCESSING', "attempts" = "attempts" + 1, "updatedAt" = now()
    WHERE "id" = (
      SELECT "id" FROM "OCRJob" WHERE "status" = 'QUEUED'
      ORDER BY "createdAt" ASC LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", "fileObjectId", "attempts", "languages"`;
  return rows[0] ?? null;
}

export interface OcrRunDeps {
  readonly prisma: PrismaClient;
  readonly storage: ObjectStoragePort;
  readonly ocr: OcrPort;
}

/** Bir OCR işini çalıştırır. Başarısızlıkta içerik uydurulmaz; iş ve belge FAILED durumda kalır. */
export async function runOcrJob(deps: OcrRunDeps, jobId: string): Promise<"DONE" | "FAILED_RETRYABLE" | "FAILED_FINAL"> {
  const job = await deps.prisma.oCRJob.findUniqueOrThrow({ where: { id: jobId }, include: { fileObject: true } });
  const file = job.fileObject;

  const fail = async (retryable: boolean, code: string): Promise<"FAILED_RETRYABLE" | "FAILED_FINAL"> => {
    await deps.prisma.$transaction(async (tx) => {
      await tx.oCRJob.update({
        where: { id: jobId },
        data: { status: retryable ? "FAILED_RETRYABLE" : "FAILED_FINAL", lastErrorCode: code, confidence: null, resultStorageKey: null },
      });
      for (const doc of await documentsOnFile(tx, file.id)) {
        await applyIngest(tx, doc, retryable ? "OCR_FAILED_TRANSIENT" : "OCR_FAILED_FINAL", job.attempts);
      }
    });
    return retryable ? "FAILED_RETRYABLE" : "FAILED_FINAL";
  };

  if (file.scanStatus !== "CLEAN" || file.storagePrefix !== "objects") {
    return fail(false, "FILE_NOT_CLEAN");
  }

  let bytes: Uint8Array;
  try {
    bytes = await deps.storage.get(file.storageKey);
  } catch {
    return fail(true, "STORAGE_READ_FAILED");
  }

  const outcome = await deps.ocr.recognize({ bytes, mime: file.mimeType, languages: job.languages });
  if (outcome.status === "FAILED") return fail(outcome.retryable, outcome.code);

  const resultKey = `objects/ocr-${jobId}`;
  const avg = outcome.pages.reduce((a, p) => a + p.confidence, 0) / Math.max(outcome.pages.length, 1);
  const confidence = Math.round(avg * 10000) / 10000;
  const ocrText = outcome.pages.map((p) => p.text).join("\n");
  // Yeniden denemede sonuç nesnesi zaten yazılmış olabilir: üzerine yazma yok, varsa atla.
  if (!(await deps.storage.exists(resultKey))) {
    await deps.storage.put(resultKey, new TextEncoder().encode(JSON.stringify({ pages: outcome.pages })));
  }

  await deps.prisma.$transaction(async (tx) => {
    await tx.oCRJob.update({
      where: { id: jobId },
      data: { status: "DONE", confidence, resultStorageKey: resultKey, lastErrorCode: null },
    });
    for (const doc of await documentsOnFile(tx, file.id)) {
      const meta = await tx.metadataValue.findMany({
        where: { documentId: doc.id },
        include: { definition: true },
      });
      const metaTexts = meta.map((m) => m.valueText ?? m.valueNumber?.toString() ?? m.valueDate?.toISOString().slice(0, 10) ?? "");
      await tx.document.update({
        where: { id: doc.id },
        data: { searchText: buildSearchText(doc.title, metaTexts, ocrText) },
      });
      // RAG indeksi (Faz 6): yalnız OCR tamamlanan güncel sürüm parçaları yazılır (yeniden deneme güvenli).
      await indexOcrChunks(tx, { documentId: doc.id, fileObjectId: file.id, pages: outcome.pages });
      const after = await applyIngest(tx, doc, "OCR_SUCCEEDED");
      if (after === "METADATA_PENDING") await applyIngest(tx, { id: doc.id, ingestStatus: after }, "METADATA_COMPLETED");
    }
  });
  return "DONE";
}

/** Yeniden deneme: yalnızca FAILED_RETRYABLE ve deneme sınırı içinde. */
export async function requestOcrRetry(prisma: PrismaClient, fileObjectId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const job = await tx.oCRJob.findFirst({ where: { fileObjectId }, orderBy: { createdAt: "desc" } });
    if (!job || job.status !== "FAILED_RETRYABLE" || job.attempts >= MAX_OCR_ATTEMPTS) {
      throw new DomainError("OCR_NOT_RETRYABLE", "Bu OCR işi yeniden denenemez");
    }
    await tx.oCRJob.update({ where: { id: job.id }, data: { status: "QUEUED" } });
    for (const doc of await documentsOnFile(tx, fileObjectId)) {
      if (doc.ingestStatus === "FAILED_RETRYABLE") {
        await applyIngest(tx, doc, "RETRY_REQUESTED", job.attempts);
      }
    }
  });
}
