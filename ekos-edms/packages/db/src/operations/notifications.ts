// Bildirimler (Faz 5, madde 2). Uygulama içi bildirim ZORUNLUDUR ve her zaman yazılır; e-posta/Teams
// teslimi ayrı bir kuyruk işidir. Teslim başarısızlığı uygulama içi kaydı ve görevleri ETKİLEMEZ.
// Yapılandırılmamış kanal "Gönderildi" olarak kaydedilmez: NOT_CONFIGURED denemesi yazılır.
import { type PrismaClient } from "@prisma/client";
import { uuidv7, type ActorContext } from "@ekos/core";
import { appendAudit } from "../audit.js";
import { DomainError } from "../documents/shared.js";

export const NOTIFY_QUEUE = "notify";
export const DELIVERY_CHANNELS = ["EMAIL", "TEAMS"] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

export interface NotificationInput {
  readonly userId: string;
  readonly type: string;
  readonly title: string;
  readonly body: string;
  readonly subjectType?: string | null;
  readonly subjectId?: string | null;
  readonly dedupeKey: string;
  /** Hayır ise yalnızca uygulama içi (eskalasyon bildirimleri döngüye girmesin diye). */
  readonly deliver?: boolean;
}

/** Yeni oluşturulan bildirimleri yazar; aynı dedupeKey varsa atlar. Teslim işleri kuyruğa alınır. Dönüş: yeni kayıt sayısı. */
export async function createNotifications(prisma: PrismaClient, items: readonly NotificationInput[]): Promise<number> {
  if (items.length === 0) return 0;
  const keys = items.map((i) => i.dedupeKey.slice(0, 300));
  const existing = new Set((await prisma.notification.findMany({ where: { dedupeKey: { in: keys } }, select: { dedupeKey: true } })).map((r) => r.dedupeKey));
  const fresh = items.filter((i) => !existing.has(i.dedupeKey.slice(0, 300)));
  if (fresh.length === 0) return 0;
  return prisma.$transaction(async (tx) => {
    const rows = fresh.map((i) => ({
      id: uuidv7(),
      userId: i.userId,
      type: i.type.slice(0, 60),
      title: i.title.slice(0, 300),
      body: i.body.slice(0, 2000),
      subjectType: i.subjectType ?? null,
      subjectId: i.subjectId ?? null,
      dedupeKey: i.dedupeKey.slice(0, 300),
    }));
    await tx.notification.createMany({ data: rows, skipDuplicates: true });
    for (const i of fresh) {
      if (i.deliver === false) continue;
      const row = rows.find((r) => r.dedupeKey === i.dedupeKey.slice(0, 300));
      if (!row) continue;
      const prefs = await tx.notificationPreference.findMany({ where: { userId: i.userId } });
      for (const ch of DELIVERY_CHANNELS) {
        const pref = prefs.find((p) => p.channel === ch);
        if (pref && !pref.enabled) continue;
        await tx.backgroundJob.create({
          data: {
            id: uuidv7(),
            queue: NOTIFY_QUEUE,
            name: "deliver",
            payloadRef: { notificationId: row.id, channel: ch },
            idempotencyKey: `notify:${row.id}:${ch}`,
            maxAttempts: 5,
          },
        });
      }
    }
    return rows.length;
  });
}

/** Kullanıcının yönetici (config.manage) olduğu aktif hesapları: eskalasyon alıcıları. */
export async function globalPermissionHolders(prisma: PrismaClient, permission: string, now: Date): Promise<string[]> {
  const ms = await prisma.membership.findMany({
    where: {
      revokedAt: null,
      role: { permissions: { some: { permission: { code: permission } } } },
      user: { status: "ACTIVE" },
    },
    select: { userId: true, validFrom: true, validUntil: true },
  });
  const ids = ms.filter((m) => (!m.validFrom || m.validFrom <= now) && (!m.validUntil || m.validUntil > now)).flatMap((m) => (m.userId ? [m.userId] : []));
  return [...new Set(ids)];
}

/** Uygulama içi bildirimler: kullanıcının kendi kayıtları ve teslim özeti (her kanal için son durum). */
export async function listMyNotifications(prisma: PrismaClient, input: { actor: ActorContext; unreadOnly?: boolean; limit?: number }) {
  const rows = await prisma.notification.findMany({
    where: { userId: input.actor.userId, ...(input.unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: "desc" },
    take: Math.min(input.limit ?? 50, 200),
    include: { attempts: { orderBy: { attemptNo: "asc" } } },
  });
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    body: r.body,
    subjectType: r.subjectType,
    subjectId: r.subjectId,
    readAt: r.readAt,
    createdAt: r.createdAt,
    deliveries: r.attempts.map((a) => ({ channel: a.channel, status: a.status, attemptNo: a.attemptNo, errorCode: a.errorCode, attemptedAt: a.attemptedAt })),
  }));
}

export async function markNotificationRead(prisma: PrismaClient, input: { actor: ActorContext; now: Date; notificationId: string }): Promise<void> {
  const r = await prisma.notification.updateMany({
    where: { id: input.notificationId, userId: input.actor.userId, readAt: null },
    data: { readAt: input.now },
  });
  if (r.count === 0) {
    const exists = await prisma.notification.findFirst({ where: { id: input.notificationId, userId: input.actor.userId } });
    if (!exists) throw new DomainError("NOT_FOUND");
  }
}

// ---- Teslim kuyruğu ----

export interface DeliveryMessage {
  readonly to: string | null;
  readonly subject: string;
  readonly body: string;
  readonly recipientName: string;
}
export type DeliveryResult =
  | { readonly status: "SENT" }
  | { readonly status: "NOT_CONFIGURED" }
  | { readonly status: "FAILED"; readonly errorCode: string; readonly errorMessage: string };
/** Kanal gönderici portu. Uygulama adaptörleri (SMTP, Teams) bu arayüzü uygular; yapılandırılmamışsa null verilir. */
export interface DeliverySender {
  send(msg: DeliveryMessage): Promise<DeliveryResult>;
}
export type DeliverySenders = Partial<Record<DeliveryChannel, DeliverySender | null>>;

const BACKOFF_BASE_SECONDS = 60;

export interface WorkerSummary {
  readonly processed: number;
  readonly sent: number;
  readonly notConfigured: number;
  readonly retryScheduled: number;
  readonly dead: number;
}

/**
 * Teslim işçisi. Her iş: gönder → deneme kaydı (NotificationDeliveryAttempt) → SENT/NOT_CONFIGURED: tamam;
 * FAILED: yeniden dene (üstel geri çekilme) veya son denemede DEAD + JobFailure + YÖNETİCİ ESKALASYONU.
 */
export async function runNotificationWorker(
  prisma: PrismaClient,
  input: { now: Date; correlationId: string; senders: DeliverySenders; limit?: number },
): Promise<WorkerSummary> {
  const jobs = await prisma.backgroundJob.findMany({
    where: { queue: NOTIFY_QUEUE, status: "QUEUED", runAfter: { lte: input.now } },
    orderBy: { runAfter: "asc" },
    take: Math.min(input.limit ?? 50, 200),
  });
  const summary = { processed: 0, sent: 0, notConfigured: 0, retryScheduled: 0, dead: 0 };

  for (const job of jobs) {
    // Yarış koşulu: yalnızca QUEUED durumdaki iş ACTIVE'e alınabilir.
    const claimed = await prisma.backgroundJob.updateMany({
      where: { id: job.id, status: "QUEUED" },
      data: { status: "ACTIVE", attempts: { increment: 1 } },
    });
    if (claimed.count !== 1) continue;
    summary.processed++;
    const attemptNo = job.attempts + 1;
    const p = job.payloadRef as { notificationId?: string; channel?: string };
    const channel = p.channel === "EMAIL" || p.channel === "TEAMS" ? p.channel : null;
    const notif = p.notificationId ? await prisma.notification.findUnique({ where: { id: p.notificationId }, include: { user: true } }) : null;

    let result: DeliveryResult;
    if (!channel || !notif) {
      result = { status: "FAILED", errorCode: "PAYLOAD_INVALID", errorMessage: "İş yükü geçersiz" };
    } else {
      const sender = input.senders[channel] ?? null;
      if (!sender) {
        result = { status: "NOT_CONFIGURED" };
      } else {
        try {
          result = await sender.send({
            to: channel === "EMAIL" ? notif.user.email : null,
            subject: notif.title,
            body: notif.body,
            recipientName: notif.user.displayName,
          });
        } catch {
          // Ham hata metni saklanmaz (secret/yanıt sızıntısı riski); yalnızca kod.
          result = { status: "FAILED", errorCode: "SEND_EXCEPTION", errorMessage: "Gönderim istisnası" };
        }
      }
    }

    const channelForAttempt: DeliveryChannel = channel ?? "EMAIL";
    if (notif) {
      await prisma.notificationDeliveryAttempt.create({
        data: {
          id: uuidv7(),
          notificationId: notif.id,
          channel: channelForAttempt,
          status: result.status === "SENT" ? "SENT" : result.status === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "FAILED",
          attemptNo,
          errorCode: result.status === "FAILED" ? result.errorCode : null,
          errorMessage: result.status === "FAILED" ? result.errorMessage.slice(0, 500) : null,
          attemptedAt: input.now,
        },
      });
    }

    if (result.status === "SENT") {
      summary.sent++;
      await prisma.backgroundJob.update({ where: { id: job.id }, data: { status: "COMPLETED", lastError: null } });
    } else if (result.status === "NOT_CONFIGURED") {
      // Yapılandırılmamış kanal bir hata değildir; kayıt "Yapılandırılmadı" olarak kalır.
      summary.notConfigured++;
      await prisma.backgroundJob.update({ where: { id: job.id }, data: { status: "COMPLETED", lastError: "NOT_CONFIGURED" } });
    } else {
      await prisma.jobFailure.create({
        data: { id: uuidv7(), jobId: job.id, attemptNo, errorCode: result.errorCode, errorMessage: result.errorMessage.slice(0, 500), occurredAt: input.now },
      });
      if (attemptNo < job.maxAttempts) {
        summary.retryScheduled++;
        const delay = BACKOFF_BASE_SECONDS * 2 ** (attemptNo - 1) * 1000;
        await prisma.backgroundJob.update({
          where: { id: job.id },
          data: { status: "QUEUED", runAfter: new Date(input.now.getTime() + delay), lastError: result.errorCode },
        });
      } else {
        summary.dead++;
        await prisma.backgroundJob.update({ where: { id: job.id }, data: { status: "DEAD", lastError: result.errorCode } });
        // Eskalasyon: son deneme de başarısız → yöneticilere uygulama içi uyarı (içerik değil, yalnızca olay özeti).
        const admins = await globalPermissionHolders(prisma, "config.manage", input.now);
        await createNotifications(
          prisma,
          admins.map((userId) => ({
            userId,
            type: "DELIVERY_ESCALATION",
            title: "Bildirim teslimi başarısız (eskalasyon)",
            body: `${channel ?? "KANAL"} teslimi ${String(attemptNo)} denemede başarısız oldu (${result.errorCode}). Bildirim uygulama içinde görünmeye devam eder.`,
            subjectType: "NOTIFICATION",
            subjectId: notif?.id ?? null,
            dedupeKey: `esc:${job.id}:${userId}`,
            deliver: false,
          })),
        );
      }
    }
  }

  if (summary.processed > 0) {
    await prisma.$transaction(async (tx) => {
      await appendAudit(tx, {
        actorType: "WORKER", actorId: null, eventType: "NOTIFICATION_WORKER_RUN", targetType: "BACKGROUND_JOB", targetId: null,
        outcome: "SUCCESS", correlationId: input.correlationId, afterSummary: { ...summary },
      });
    });
  }
  return summary;
}

/** Bir bildirimin teslim geçmişi (UI için). */
export async function deliveryHistory(prisma: PrismaClient, notificationId: string) {
  return prisma.notificationDeliveryAttempt.findMany({ where: { notificationId }, orderBy: [{ channel: "asc" }, { attemptNo: "asc" }] });
}
