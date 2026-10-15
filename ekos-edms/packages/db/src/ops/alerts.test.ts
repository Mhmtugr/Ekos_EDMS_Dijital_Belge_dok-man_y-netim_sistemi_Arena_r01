// Faz 7 madde 7: uyarı kuralları — gerçek PostgreSQL üzerinde.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDb, type TestDb } from "../testing/pg-harness.js";
import { appendAudit } from "../audit.js";
import { dispatchSecurityAlerts, evaluateAlerts, formatAlertLine, type AlertRule } from "./alerts.js";

let db: TestDb;
const NOW = new Date();

async function audit(eventType: string, outcome: "SUCCESS" | "DENIED" | "FAILED", n = 1) {
  for (let i = 0; i < n; i++) {
    await db.prisma.$transaction((tx) =>
      appendAudit(tx, { actorType: "SYSTEM", actorId: null, eventType, targetType: "Test", targetId: null, outcome, correlationId: `alert-${eventType}-${String(i)}` }),
    );
  }
}

beforeAll(async () => {
  db = await startTestDb();
});
afterAll(async () => {
  await db.stop();
});

describe("uyarı kuralları", () => {
  it("eşik altında uyarı üretilmez", async () => {
    const rules: AlertRule[] = [{ code: "T_FAIL", severity: "WARNING", description: "t", eventTypes: ["LOGIN_FAILED"], windowMinutes: 60, threshold: 3 }];
    await audit("LOGIN_FAILED", "DENIED", 2);
    expect(await evaluateAlerts(db.prisma, new Date(), rules)).toEqual([]);
  });

  it("eşikte uyarı üretilir ve çıktı PII içermez", async () => {
    const rules: AlertRule[] = [{ code: "T_FAIL", severity: "WARNING", description: "t", eventTypes: ["LOGIN_FAILED"], windowMinutes: 60, threshold: 3 }];
    await audit("LOGIN_FAILED", "DENIED", 1);
    const fired = await evaluateAlerts(db.prisma, new Date(), rules);
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({ code: "T_FAIL", count: 3, threshold: 3, windowMinutes: 60 });
    const first = fired[0];
    if (!first) throw new Error("uyarı bekleniyordu");
    const line = formatAlertLine(first);
    expect(line).toBe("[alert] WARNING T_FAIL count=3 threshold=3 window=60m");
  });

  it("zaman penceresi dışındaki olaylar sayılmaz", async () => {
    const rules: AlertRule[] = [{ code: "T_WIN", severity: "WARNING", description: "t", eventTypes: ["LOGIN_FAILED"], windowMinutes: 15, threshold: 1 }];
    const later = new Date(NOW.getTime() + 3 * 3_600_000);
    expect(await evaluateAlerts(db.prisma, later, rules)).toEqual([]);
  });

  it("önek kuralı (BREAK_GLASS*) ve CRITICAL seviyesi çalışır", async () => {
    await audit("BREAK_GLASS_REQUESTED", "SUCCESS", 1);
    const fired = await evaluateAlerts(db.prisma, new Date(Date.now() + 1000), [
      { code: "BG", severity: "CRITICAL", description: "t", eventTypes: ["BREAK_GLASS*"], windowMinutes: 60, threshold: 1 },
    ]);
    expect(fired.map((f) => [f.code, f.severity])).toEqual([["BG", "CRITICAL"]]);
  });

  it("outcome filtresi çalışır (DENIED sayılır, SUCCESS sayılmaz)", async () => {
    await audit("SOME_OK", "SUCCESS", 5);
    const rules: AlertRule[] = [{ code: "DEN", severity: "WARNING", description: "t", outcome: "DENIED", windowMinutes: 60, threshold: 100 }];
    expect(await evaluateAlerts(db.prisma, new Date(Date.now() + 1000), rules)).toEqual([]);
  });

  it("uyarı bildirimi denetçiye yazılır; aynı pencerede tekrar yazılmaz; metin PII içermez", async () => {
    const auditor = await db.prisma.user.create({ data: { email: "gd-uyari@t.test", displayName: "GD", updatedAt: NOW } });
    const fired = [{ code: "T_BURST", description: "Test patlaması", severity: "WARNING" as const, count: 7, threshold: 5, windowMinutes: 15, since: NOW.toISOString() }];
    const at = new Date(Date.UTC(2026, 9, 15, 10, 0, 0));
    expect(await dispatchSecurityAlerts(db.prisma, fired, at, [auditor.id])).toBe(1);
    expect(await dispatchSecurityAlerts(db.prisma, fired, at, [auditor.id])).toBe(0); // aynı pencere: tekrar yok
    const n = await db.prisma.notification.findFirstOrThrow({ where: { userId: auditor.id, type: "SECURITY_ALERT" } });
    expect(n.title).toBe("Güvenlik uyarısı: T_BURST");
    expect(n.body).toContain("7 olay");
    expect(n.body).not.toMatch(/@|tokenHash|password/i);
  });

  it("varsayılan kurallar geçerlidir; geçersiz eşik reddedilir", async () => {
    await expect(evaluateAlerts(db.prisma, new Date(), [{ code: "X", severity: "WARNING", description: "t", windowMinutes: 5, threshold: 0 }])).rejects.toThrow();
    const def = await evaluateAlerts(db.prisma, new Date());
    expect(Array.isArray(def)).toBe(true);
  });
});
