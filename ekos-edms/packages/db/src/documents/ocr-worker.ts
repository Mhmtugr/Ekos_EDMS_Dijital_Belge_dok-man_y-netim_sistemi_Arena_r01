// OCR işçisi döngüsü (Faz 2, madde 4). Kuyruk SKIP LOCKED ile alınır; işçi çökerse bayat PROCESSING işleri kurtarılır.
import type { OcrPort, ObjectStoragePort } from "@ekos/core";
import { MAX_OCR_ATTEMPTS } from "@ekos/core";
import type { PrismaClient } from "@prisma/client";
import { applyIngest, claimNextOcrJob, documentsOnFile, runOcrJob } from "./pipeline.js";

export interface OcrWorkerDeps {
  readonly prisma: PrismaClient;
  readonly storage: ObjectStoragePort;
  readonly ocr: OcrPort;
}

/** Kuyruktan bir iş alıp çalıştırır. İş yoksa null. */
export async function processOneOcrJob(deps: OcrWorkerDeps): Promise<{ jobId: string; result: string } | null> {
  const job = await claimNextOcrJob(deps.prisma);
  if (!job) return null;
  const result = await runOcrJob(deps, job.id);
  return { jobId: job.id, result };
}

/**
 * Bayat PROCESSING işleri (işçi çökmesi): deneme sınırı altındaysa yeniden kuyruğa alınır;
 * sınıra ulaşmışsa kalıcı hata olarak işaretlenir ve belgeler buna göre ilerler. Dönüş: etkilenen iş sayısı.
 */
export async function recoverStaleOcrJobs(prisma: PrismaClient, olderThan: Date): Promise<number> {
  const stale = await prisma.oCRJob.findMany({ where: { status: "PROCESSING", updatedAt: { lt: olderThan } }, select: { id: true, attempts: true, fileObjectId: true } });
  for (const job of stale) {
    await prisma.$transaction(async (tx) => {
      if (job.attempts < MAX_OCR_ATTEMPTS) {
        await tx.oCRJob.update({ where: { id: job.id }, data: { status: "FAILED_RETRYABLE", lastErrorCode: "WORKER_LOST" } });
        for (const doc of await documentsOnFile(tx, job.fileObjectId)) {
          await applyIngest(tx, doc, "OCR_FAILED_TRANSIENT", job.attempts);
        }
      } else {
        await tx.oCRJob.update({ where: { id: job.id }, data: { status: "FAILED_FINAL", lastErrorCode: "WORKER_LOST" } });
        for (const doc of await documentsOnFile(tx, job.fileObjectId)) {
          await applyIngest(tx, doc, "OCR_FAILED_FINAL", job.attempts);
        }
      }
    });
  }
  return stale.length;
}
