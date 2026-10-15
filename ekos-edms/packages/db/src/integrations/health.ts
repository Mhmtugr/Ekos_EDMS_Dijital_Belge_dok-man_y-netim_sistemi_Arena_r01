// Entegrasyon sağlığı, senkron çalıştırmaları (SyncRun) ve hata kuyruğu (BackgroundJob + yeniden deneme).
import { Prisma, type PrismaClient } from "@prisma/client";
import { nextDelayMs, shouldRetry, type BackoffPolicy } from "./backoff.js";

export interface IntegrationDescriptorLike {
  readonly key: string;
  readonly displayName: string;
  readonly requiredEnv: readonly string[];
  readonly critical: boolean;
}

export type IntegrationHealthStatus = "NOT_CONFIGURED" | "CONFIGURED_UNVERIFIED" | "CONNECTED" | "FAILED";

export interface IntegrationHealthRow {
  readonly key: string;
  readonly displayName: string;
  readonly status: IntegrationHealthStatus;
  readonly critical: boolean;
  readonly lastSyncAt: Date | null;
  readonly lastError: string | null;
}

/** Ortam değişkenleri eksikse durum her zaman NOT_CONFIGURED (DB'de eski "CONNECTED" olsa bile). */
export async function getIntegrationHealth(
  prisma: PrismaClient,
  descriptors: readonly IntegrationDescriptorLike[],
  env: Readonly<Record<string, string | undefined>>,
): Promise<IntegrationHealthRow[]> {
  const rows = await prisma.integrationConnection.findMany({ where: { integrationKey: { in: descriptors.map((d) => d.key) } } });
  const byKey = new Map(rows.map((r) => [r.integrationKey, r]));
  return descriptors.map((d) => {
    const conn = byKey.get(d.key);
    const configured = d.requiredEnv.every((n) => (env[n] ?? "").trim() !== "");
    let status: IntegrationHealthStatus;
    if (!configured) status = "NOT_CONFIGURED";
    else if (!conn || conn.status === "CONFIGURED_UNVERIFIED" || conn.status === "NOT_CONFIGURED") status = "CONFIGURED_UNVERIFIED";
    else status = conn.status;
    return { key: d.key, displayName: d.displayName, status, critical: d.critical, lastSyncAt: conn?.lastSyncAt ?? null, lastError: conn?.lastError ?? null };
  });
}

/** Bağlantı denemesi sonucu. Hata metni yalnızca kısa kodlardan oluşur (sızıntı yok). */
export async function recordProbe(
  prisma: PrismaClient,
  key: string,
  result: { readonly ok: true } | { readonly ok: false; readonly errorCode: string },
  now: Date = new Date(),
): Promise<void> {
  const status = result.ok ? "CONNECTED" : "FAILED";
  const errorCode = result.ok ? null : result.errorCode.replace(/[^A-Z0-9_]/g, "").slice(0, 500) || "UNKNOWN";
  await prisma.integrationConnection.upsert({
    where: { integrationKey: key },
    create: { integrationKey: key, status, lastSyncAt: now, lastError: errorCode },
    update: { status, lastSyncAt: now, lastError: errorCode, rowVersion: { increment: 1 } },
  });
}

export async function startSyncRun(prisma: PrismaClient, key: string): Promise<string> {
  const conn = await prisma.integrationConnection.upsert({
    where: { integrationKey: key },
    create: { integrationKey: key, status: "CONFIGURED_UNVERIFIED" },
    update: {},
    select: { id: true },
  });
  const run = await prisma.syncRun.create({ data: { connectionId: conn.id, status: "RUNNING" }, select: { id: true } });
  return run.id;
}

export async function finishSyncRun(
  prisma: PrismaClient,
  runId: string,
  outcome: { readonly ok: true; readonly itemCount: number; readonly watermark: string | null } | { readonly ok: false; readonly errorCount: number },
  now: Date = new Date(),
): Promise<void> {
  const run = await prisma.syncRun.update({
    where: { id: runId },
    data: outcome.ok
      ? { status: "OK", finishedAt: now, itemCount: outcome.itemCount, externalWatermark: outcome.watermark?.slice(0, 200) ?? null }
      : { status: "FAILED", finishedAt: now, errorCount: outcome.errorCount },
    select: { connectionId: true },
  });
  if (outcome.ok) {
    await prisma.integrationConnection.update({ where: { id: run.connectionId }, data: { lastSyncAt: now, status: "CONNECTED", lastError: null } });
  }
}

export async function enqueueJob(
  prisma: PrismaClient,
  input: { readonly queue: string; readonly name: string; readonly payloadRef: Prisma.InputJsonObject; readonly idempotencyKey: string; readonly maxAttempts?: number },
): Promise<{ readonly id: string; readonly created: boolean }> {
  const existing = await prisma.backgroundJob.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true } });
  if (existing) return { id: existing.id, created: false };
  try {
    const job = await prisma.backgroundJob.create({
      data: {
        queue: input.queue,
        name: input.name,
        payloadRef: input.payloadRef,
        idempotencyKey: input.idempotencyKey,
        maxAttempts: input.maxAttempts ?? 5,
      },
      select: { id: true },
    });
    return { id: job.id, created: true };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const again = await prisma.backgroundJob.findUniqueOrThrow({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true } });
      return { id: again.id, created: false };
    }
    throw e;
  }
}

/** Başarısız iş: yeniden denenebilirse geri çekilmeyle QUEUED, aksi halde DEAD (hata kuyruğu). */
export async function failJob(
  prisma: PrismaClient,
  jobId: string,
  input: { readonly errorCode: string; readonly retryable: boolean },
  policy: BackoffPolicy,
  now: Date = new Date(),
): Promise<"RETRY_SCHEDULED" | "DEAD"> {
  const job = await prisma.backgroundJob.findUniqueOrThrow({ where: { id: jobId }, select: { attempts: true } });
  const attempts = job.attempts + 1;
  const lastError = input.errorCode.replace(/[^A-Z0-9_]/g, "").slice(0, 500) || "UNKNOWN";
  if (shouldRetry(policy, attempts, input.retryable)) {
    await prisma.backgroundJob.update({
      where: { id: jobId },
      data: { attempts, status: "QUEUED", lastError, runAfter: new Date(now.getTime() + nextDelayMs(policy, attempts)) },
    });
    return "RETRY_SCHEDULED";
  }
  await prisma.backgroundJob.update({ where: { id: jobId }, data: { attempts, status: "DEAD", lastError } });
  return "DEAD";
}

export async function listDeadJobs(prisma: PrismaClient, queue: string, limit = 50) {
  return prisma.backgroundJob.findMany({
    where: { queue, status: "DEAD" },
    orderBy: { updatedAt: "desc" },
    take: Math.min(Math.max(limit, 1), 200),
    select: { id: true, name: true, attempts: true, lastError: true, updatedAt: true },
  });
}
