// Faz 7 madde 7: denetim olayları üzerinden eşik tabanlı uyarılar.
// Kurallar yalnız sayım yapar; çıktı olay içeriği, kullanıcı kimliği veya IP taşımaz (yalnız kural kodu, sayı, eşik, pencere).
// Uyarılar ayrı bir bildirim kanalına bağlanabilir; bu modül karar üretir, göndermez.
import type { PrismaClient } from "@prisma/client";
import { createNotifications, globalPermissionHolders, type NotificationInput } from "../operations/notifications.js";

export type AlertSeverity = "WARNING" | "CRITICAL";

export interface AlertRule {
  readonly code: string;
  readonly severity: AlertSeverity;
  readonly description: string;
  /** Tam eşleşen olay türleri VEYA önek (sonunda *) */
  readonly eventTypes?: readonly string[];
  readonly outcome?: "SUCCESS" | "DENIED" | "FAILED";
  readonly windowMinutes: number;
  /** Pencerede bu sayıya ulaşılırsa (>=) uyarı üretilir. */
  readonly threshold: number;
}

export interface FiredAlert {
  readonly code: string;
  readonly description: string;
  readonly severity: AlertSeverity;
  readonly count: number;
  readonly threshold: number;
  readonly windowMinutes: number;
  readonly since: string;
}

export const DEFAULT_ALERT_RULES: readonly AlertRule[] = [
  { code: "AUTH_FAILURE_BURST", severity: "WARNING", description: "Kısa sürede çok sayıda başarısız giriş", eventTypes: ["LOGIN_FAILED", "OIDC_LOGIN_DENIED"], windowMinutes: 15, threshold: 20 },
  { code: "ACCOUNT_LOCKOUT", severity: "WARNING", description: "Hesap kilitlendi (çok sayıda hatalı parola)", eventTypes: ["LOGIN_LOCKED"], windowMinutes: 60, threshold: 1 },
  { code: "ACCESS_DENIED_BURST", severity: "WARNING", description: "Kısa sürede çok sayıda yetki reddi (olası tarama)", outcome: "DENIED", windowMinutes: 15, threshold: 50 },
  { code: "BREAK_GLASS_ACTIVITY", severity: "CRITICAL", description: "Acil erişim (break-glass) olayı", eventTypes: ["BREAK_GLASS*"], windowMinutes: 60, threshold: 1 },
  { code: "MALWARE_DETECTED", severity: "CRITICAL", description: "Antivirüs enfekte dosya tespit etti", eventTypes: ["SCAN_INFECTED"], windowMinutes: 60, threshold: 1 },
];

function eventTypeFilter(types: readonly string[]) {
  const exact = types.filter((t) => !t.endsWith("*"));
  const prefixes = types.filter((t) => t.endsWith("*")).map((t) => t.slice(0, -1));
  return {
    OR: [
      ...(exact.length > 0 ? [{ eventType: { in: [...exact] } }] : []),
      ...prefixes.map((p) => ({ eventType: { startsWith: p } })),
    ],
  };
}

/** Kuralları `now` anında değerlendirir. Eşik geçilenleri döndürür. */
export async function evaluateAlerts(
  prisma: PrismaClient,
  now: Date = new Date(),
  rules: readonly AlertRule[] = DEFAULT_ALERT_RULES,
): Promise<FiredAlert[]> {
  for (const r of rules) {
    if (!Number.isInteger(r.threshold) || r.threshold < 1) throw new Error(`Geçersiz eşik: ${r.code}`);
    if (!Number.isInteger(r.windowMinutes) || r.windowMinutes < 1 || r.windowMinutes > 10_080) throw new Error(`Geçersiz pencere: ${r.code}`);
  }
  const fired: FiredAlert[] = [];
  for (const r of rules) {
    const since = new Date(now.getTime() - r.windowMinutes * 60_000);
    const where = {
      occurredAt: { gte: since, lte: now },
      ...(r.eventTypes ? eventTypeFilter(r.eventTypes) : {}),
      ...(r.outcome ? { outcome: r.outcome } : {}),
    };
    const count = await prisma.auditEvent.count({ where });
    if (count >= r.threshold) {
      fired.push({ code: r.code, description: r.description, severity: r.severity, count, threshold: r.threshold, windowMinutes: r.windowMinutes, since: since.toISOString() });
    }
  }
  return fired;
}

/** Operasyon günlüğü satırı: yalnız kural kodu ve sayılar (PII yok). */
export function formatAlertLine(a: FiredAlert): string {
  return `[alert] ${a.severity} ${a.code} count=${String(a.count)} threshold=${String(a.threshold)} window=${String(a.windowMinutes)}m`;
}

/**
 * Tetiklenen uyarıları Güvenlik Denetçilerine (audit.export yetkisi olanlar) uygulama içi bildirim olarak yazar.
 * Mesaj yalnız kural kodu, açıklama ve sayılar içerir (PII yok). Aynı kural + kullanıcı + pencere için tekrar yazmaz.
 * Dönüş: yeni bildirim sayısı.
 */
export async function dispatchSecurityAlerts(
  prisma: PrismaClient,
  fired: readonly FiredAlert[],
  now: Date = new Date(),
  recipients?: readonly string[],
): Promise<number> {
  if (fired.length === 0) return 0;
  const to = recipients ?? (await globalPermissionHolders(prisma, "audit.export", now));
  const items: NotificationInput[] = [];
  for (const a of fired) {
    const bucket = Math.floor(now.getTime() / (a.windowMinutes * 60_000));
    for (const userId of to) {
      items.push({
        userId,
        type: "SECURITY_ALERT",
        title: `Güvenlik uyarısı: ${a.code}`,
        body: `${a.description}. Son ${String(a.windowMinutes)} dakikada ${String(a.count)} olay (eşik: ${String(a.threshold)}). Ayrıntı için denetim kayıtlarına bakın.`,
        dedupeKey: `alert:${a.code}:${userId}:${String(bucket)}`,
        deliver: true,
      });
    }
  }
  return createNotifications(prisma, items);
}
