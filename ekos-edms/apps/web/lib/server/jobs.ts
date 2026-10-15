// Arka plan işleri: hatırlatma döngüsü + bildirim teslim işçisi. Hem API (yönetici tetiklemesi) hem CLI (zamanlayıcı) kullanır.
// Göndericiler yalnızca ayar etkinse VE secretRef'in gösterdiği ortam değişkeni tanımlıysa kurulur; aksi halde null
// (teslim denemesi NOT_CONFIGURED olarak kaydedilir — "Gönderildi" asla sahte yazılmaz).
import { SmtpSender, TeamsSender, type DeliverySenders } from "@ekos/adapters";
import { dispatchSecurityAlerts, evaluateAlerts, getCurrentSetting, runNotificationWorker, runReminderCycle, SETTING_KEYS, type PrismaClient } from "@ekos/db";
import type { ActorContext } from "@ekos/core";

interface ChannelSetting {
  enabled: boolean;
  secretRef: string;
  from: string | undefined;
}

function readChannel(v: Record<string, unknown> | null): ChannelSetting | null {
  if (!v || typeof v.enabled !== "boolean" || typeof v.secretRef !== "string") return null;
  return { enabled: v.enabled, secretRef: v.secretRef, from: typeof v.from === "string" ? v.from : undefined };
}

/** Kanal durumu: NOT_CONFIGURED | CONFIGURED_UNVERIFIED (ayar var, ortam değişkeni eksik ya da kapalı → NOT_CONFIGURED) */
export async function channelStatus(prisma: PrismaClient): Promise<{ email: "NOT_CONFIGURED" | "READY"; teams: "NOT_CONFIGURED" | "READY"; emailFrom: string | null }> {
  const email = readChannel(await getCurrentSetting(prisma, SETTING_KEYS.EMAIL_CHANNEL));
  const teams = readChannel(await getCurrentSetting(prisma, SETTING_KEYS.TEAMS_CHANNEL));
  const emailReady = !!email && email.enabled && !!process.env[email.secretRef]?.trim() && !!email.from;
  const teamsReady = !!teams && teams.enabled && !!process.env[teams.secretRef]?.trim();
  return { email: emailReady ? "READY" : "NOT_CONFIGURED", teams: teamsReady ? "READY" : "NOT_CONFIGURED", emailFrom: email?.from ?? null };
}

export async function buildSenders(prisma: PrismaClient): Promise<DeliverySenders> {
  const email = readChannel(await getCurrentSetting(prisma, SETTING_KEYS.EMAIL_CHANNEL));
  const teams = readChannel(await getCurrentSetting(prisma, SETTING_KEYS.TEAMS_CHANNEL));
  const emailUrl = email?.enabled && email.from ? process.env[email.secretRef]?.trim() : undefined;
  const teamsUrl = teams?.enabled ? process.env[teams.secretRef]?.trim() : undefined;
  return {
    EMAIL: emailUrl && email?.from ? new SmtpSender(emailUrl, email.from) : null,
    TEAMS: teamsUrl ? new TeamsSender(teamsUrl) : null,
  };
}

export async function runAllJobs(prisma: PrismaClient, input: { actor: ActorContext; now: Date; correlationId: string }) {
  const reminders = await runReminderCycle(prisma, input);
  const senders = await buildSenders(prisma);
  const delivery = await runNotificationWorker(prisma, { now: input.now, correlationId: input.correlationId, senders });
  // Faz 7: denetim olaylarından eşik uyarıları; yalnız kural kodu ve sayılar, Güvenlik Denetçilerine bildirim.
  const fired = await evaluateAlerts(prisma, input.now);
  const alertNotifications = await dispatchSecurityAlerts(prisma, fired, input.now);
  return { reminders, delivery, alerts: { fired: fired.map((f) => f.code), notified: alertNotifications } };
}
