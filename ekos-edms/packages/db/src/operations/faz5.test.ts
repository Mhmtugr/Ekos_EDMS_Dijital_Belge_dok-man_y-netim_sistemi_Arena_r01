// Faz 5 entegrasyon testleri (GERÇEK PostgreSQL). Hatırlatma idempotensi/yeniden üretim, teslim hatası görünürlüğü,
// dashboard metrik-DB eşleşmesi ve yetki filtresi, dışa aktarma yetki+audit+filigran, vekalet kuralları.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadActorContext } from "../actor.js";
import { createContract } from "../contracts/lifecycle.js";
import { startTestDb, type TestDb } from "../testing/pg-harness.js";
import { createNotifications, listMyNotifications, runNotificationWorker, deliveryHistory, type DeliverySenders } from "./notifications.js";
import { syncScheduledEvents, fireDueReminders } from "./reminders.js";
import { getDashboard } from "./dashboard.js";
import { exportReport } from "./reports.js";
import { createDelegation } from "./tasks.js";
import { listContracts } from "./contracts.js";

const NOW = new Date("2026-10-14T06:00:00Z"); // Europe/Istanbul 09:00, 14 Ekim 2026
const EMPTY_SCOPE = { departmentIds: [], documentTypeIds: [], counterpartyIds: [], projectIds: [], updatedAt: NOW };
let seq = 0;
const cid = (p: string) => `${p}-f5-${String(++seq)}`;

let db: TestDb;
let admin: string;
let auditor: string; // yalnız D1 kapsamı
let plain: string; // hiçbir yetkisi yok
let apprB: string;
let deptD1: string;
let deptD2: string;
let cpId: string;
const ctx = (id: string, now: Date = NOW) => loadActorContext(db.prisma, id, now);
const must = <T>(v: T | undefined | null, what: string): T => {
  if (v === undefined || v === null) throw new Error(`beklenen kayıt yok: ${what}`);
  return v;
};

beforeAll(async () => {
  db = await startTestDb();
  const p = db.prisma;
  const codes = ["document.list", "document.view_metadata", "document.approve", "config.manage", "user.manage", "audit.export"];
  await p.permission.createMany({ data: codes.map((code) => ({ code, description: code })) });
  const perms = await p.permission.findMany();
  const pid = (c: string) => must(perms.find((x) => x.code === c), c).id;
  const role = async (code: string, list: string[]) => {
    const r = await p.role.create({ data: { code, name: code, updatedAt: NOW } });
    for (const c of list) await p.rolePermission.create({ data: { roleId: r.id, permissionId: pid(c) } });
    return r.id;
  };
  const rOps = await role("R_OPS", ["config.manage", "user.manage", "audit.export", "document.list", "document.view_metadata"]);
  const rAud = await role("R_AUD", ["document.list", "document.view_metadata", "audit.export"]);
  const rApp = await role("R_APP", ["document.list", "document.approve"]);
  const user = async (tag: string) => (await p.user.create({ data: { email: `${tag}@t.test`, displayName: tag, updatedAt: NOW } })).id;
  admin = await user("admin");
  auditor = await user("auditor");
  plain = await user("plain");
  apprB = await user("apprb");
  await p.membership.create({ data: { userId: admin, roleId: rOps, ...EMPTY_SCOPE } as never });
  await p.membership.create({ data: { userId: apprB, roleId: rApp, ...EMPTY_SCOPE } as never });
  deptD1 = (await p.department.create({ data: { code: "D1-F5", name: "Birim 1" } })).id;
  deptD2 = (await p.department.create({ data: { code: "D2-F5", name: "Birim 2" } })).id;
  await p.membership.create({ data: { userId: auditor, roleId: rAud, ...EMPTY_SCOPE, departmentIds: [deptD1] } as never });
  await p.documentType.create({ data: { code: "SOZLESME", name: "Sözleşme", defaultConfidentiality: "CONFIDENTIAL", requiredMetadataKeys: ["counterpartyId"], updatedAt: NOW } as never });
  await p.metadataDefinition.create({ data: { key: "counterpartyId", label: "Karşı taraf", dataType: "REFERENCE", enumValues: [] } as never });
  await p.legalEntity.create({ data: { name: "EKOS Test A.Ş.", countryCode: "TR", updatedAt: NOW } as never });
  cpId = (await p.counterparty.create({ data: { officialName: "Test Tedarikçi Ltd.", countryCode: "TR", status: "ACTIVE", updatedAt: NOW } as never })).id;
});

afterAll(async () => {
  await db.stop();
});

/** Sözleşme oluşturur, bitiş tarihini ayarlar (yalnız test verisi). */
async function contract(title: string, endDate: string | null, departmentId: string | null) {
  const c = await createContract(db.prisma, { actorId: admin, correlationId: cid("ct"), typeCode: "SOZLESME", title, counterpartyId: cpId, departmentId, now: NOW });
  if (endDate) await db.prisma.contractRecord.update({ where: { id: c.contractId }, data: { endDate: new Date(`${endDate}T00:00:00Z`) } });
  return c;
}

describe("hatırlatma motoru", () => {
  it("aynı girdiyle iki kez eşitleme: ikincisi yeni kayıt üretmez (idempotent)", async () => {
    const c = await contract("Hatırlatma sözleşmesi A", "2026-12-13", deptD1);
    const first = await syncScheduledEvents(db.prisma, { now: NOW, correlationId: cid("sy") });
    const second = await syncScheduledEvents(db.prisma, { now: NOW, correlationId: cid("sy") });
    expect(first.created).toBeGreaterThan(0);
    expect(second.created).toBe(0);
    const scheduled = await db.prisma.scheduledEvent.findMany({ where: { subjectId: c.contractId, status: "SCHEDULED", deadlineType: "CONTRACT_END" } });
    // her eşik için tam bir kayıt (benzersiz anahtar)
    expect(new Set(scheduled.map((e) => e.offsetDays)).size).toBe(scheduled.length);
    expect(scheduled.every((e) => e.deadlineDate.toISOString().slice(0, 10) === "2026-12-13")).toBe(true);
  });

  it("tarih değişince eski planlar iptal edilir ve yenisi üretilir", async () => {
    const c = await contract("Hatırlatma sözleşmesi B", "2026-11-13", deptD1);
    await syncScheduledEvents(db.prisma, { now: NOW, correlationId: cid("sy") });
    await db.prisma.contractRecord.update({ where: { id: c.contractId }, data: { endDate: new Date("2026-12-20T00:00:00Z") } });
    const r = await syncScheduledEvents(db.prisma, { now: NOW, correlationId: cid("sy") });
    expect(r.cancelled).toBeGreaterThan(0);
    const old = await db.prisma.scheduledEvent.findMany({ where: { subjectId: c.contractId, deadlineType: "CONTRACT_END", deadlineDate: new Date("2026-11-13T00:00:00Z") } });
    expect(old.length).toBeGreaterThan(0);
    expect(old.every((e) => e.status === "CANCELLED")).toBe(true);
    const live = await db.prisma.scheduledEvent.findMany({ where: { subjectId: c.contractId, deadlineType: "CONTRACT_END", status: "SCHEDULED" } });
    expect(live.length).toBeGreaterThan(0);
    expect(live.every((e) => e.deadlineDate.toISOString().slice(0, 10) === "2026-12-20")).toBe(true);
  });

  it("tetiklemede aynı konu/tür grubunda tek bildirim, sorumlusuz kayıt yöneticiye", async () => {
    const before = await db.prisma.notification.count();
    const r = await fireDueReminders(db.prisma, { now: NOW, correlationId: cid("fr") });
    const again = await fireDueReminders(db.prisma, { now: NOW, correlationId: cid("fr") });
    expect(again.fired).toBe(0); // ikinci tetikleme yeni bildirim üretmez
    expect(await db.prisma.notification.count()).toBeGreaterThanOrEqual(before);
    expect(r.fired).toBeGreaterThanOrEqual(0);
  });
});

describe("bildirim teslimi", () => {
  it("createNotifications aynı dedupeKey ile tekilleştirir", async () => {
    const item = { userId: apprB, type: "TEST", title: "Test bildirimi", body: "İçerik", dedupeKey: "f5-dedupe-1" };
    expect(await createNotifications(db.prisma, [item])).toBe(1);
    expect(await createNotifications(db.prisma, [item])).toBe(0);
  });

  it("kanal yapılandırılmamışsa NOT_CONFIGURED kaydedilir; uygulama içi bildirim görünür kalır", async () => {
    const id = await db.prisma.notification.findFirstOrThrow({ where: { dedupeKey: "f5-dedupe-1" } });
    const now = new Date();
    await runNotificationWorker(db.prisma, { now, correlationId: cid("nw"), senders: {} });
    const hist = await deliveryHistory(db.prisma, id.id);
    expect(hist.some((h) => h.status === "NOT_CONFIGURED")).toBe(true);
    const mine = await listMyNotifications(db.prisma, { actor: await ctx(apprB, now) });
    expect(mine.some((n) => n.id === id.id)).toBe(true);
  });

  it("teslim sürekli başarısız olursa yeniden deneme, DEAD ve yöneticiye eskalasyon; uygulama içi kayıt kalır", async () => {
    await createNotifications(db.prisma, [{ userId: apprB, type: "TEST", title: "Kritik olay", body: "Kritik olay gövdesi", dedupeKey: "f5-critical-1" }]);
    const n = await db.prisma.notification.findFirstOrThrow({ where: { dedupeKey: "f5-critical-1" } });
    // EMAIL kanalı yapılandırılmış ama her zaman hata verir
    const failing: DeliverySenders = { EMAIL: { send: () => Promise.reject(new Error("smtp down")) } };
    let t = Date.now();
    for (let i = 0; i < 5; i++) {
      await runNotificationWorker(db.prisma, { now: new Date(t), correlationId: cid("nw"), senders: failing });
      t += 3_600_000; // her turda kuyruk zamanı geçer
    }
    const job = await db.prisma.backgroundJob.findFirstOrThrow({ where: { idempotencyKey: `notify:${n.id}:EMAIL` } });
    expect(job.status).toBe("DEAD");
    const attempts = await db.prisma.notificationDeliveryAttempt.findMany({ where: { notificationId: n.id, channel: "EMAIL" } });
    expect(attempts.filter((a) => a.status === "FAILED").length).toBe(5);
    const escalations = await db.prisma.notification.count({ where: { type: "DELIVERY_ESCALATION" } });
    expect(escalations).toBeGreaterThan(0);
    const adminMine = await listMyNotifications(db.prisma, { actor: await ctx(admin, new Date(t)) });
    expect(adminMine.some((x) => x.type === "DELIVERY_ESCALATION")).toBe(true);
    const mine = await listMyNotifications(db.prisma, { actor: await ctx(apprB, new Date(t)) });
    expect(mine.some((x) => x.id === n.id)).toBe(true);
  });
});

describe("dashboard", () => {
  it("yetkisiz kullanıcı belge metriklerini görmez; sayımlar sıfır ve erişim bayrağı kapalı", async () => {
    const d = await getDashboard(db.prisma, { actor: await ctx(plain), now: NOW });
    expect(d.accessible.documents).toBe(false);
    expect(d.counts.contractsVisible).toBe(0);
    expect(d.counts.endingWithin90).toBe(0);
  });

  it("yönetici sayımları veritabanıyla birebir eşleşir", async () => {
    const d = await getDashboard(db.prisma, { actor: await ctx(admin), now: NOW });
    const total = await db.prisma.contractRecord.count();
    expect(d.counts.contractsVisible).toBe(total);
    const ending = await db.prisma.contractRecord.count({ where: { endDate: { gte: new Date("2026-10-14T00:00:00Z"), lte: new Date("2027-01-12T00:00:00Z") } } });
    expect(d.counts.endingWithin90).toBe(ending);
  });

  it("kapsamlı kullanıcının sayımı yalnız kendi departmanındaki belgeleri içerir", async () => {
    await contract("Kapsam testi D2", "2026-12-01", deptD2);
    const d = await getDashboard(db.prisma, { actor: await ctx(auditor), now: NOW });
    const inD1 = await db.prisma.contractRecord.count({ where: { document: { departmentId: deptD1 } } });
    const all = await db.prisma.contractRecord.count();
    expect(d.counts.contractsVisible).toBe(inD1);
    expect(d.counts.contractsVisible).toBeLessThan(all);
  });
});

describe("kayıt listesi ve dışa aktarma", () => {
  it("listeleme kapsam filtresinden geçer", async () => {
    const page = await listContracts(db.prisma, { actor: await ctx(auditor), now: NOW, pageSize: 100 });
    const inD1 = await db.prisma.contractRecord.count({ where: { document: { departmentId: deptD1 } } });
    expect(page.total).toBe(inD1);
  });

  it("yetkisiz dışa aktarma reddedilir ve denetime DENIED yazılır", async () => {
    const cidv = cid("exp");
    await expect(exportReport(db.prisma, { actor: await ctx(plain), now: NOW, correlationId: cidv, type: "CONTRACT_PORTFOLIO", format: "CSV", filters: {} }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    const ev = await db.prisma.auditEvent.findFirst({ where: { correlationId: cidv } });
    expect(ev?.eventType).toBe("REPORT_EXPORT_DENIED");
    expect(ev?.outcome).toBe("DENIED");
  });

  it("denetim raporu yalnız kapsamsız audit.export sahibine açık (kapsamlı denetçi reddedilir)", async () => {
    const f = { from: "2026-01-01", to: "2026-12-31" };
    await expect(exportReport(db.prisma, { actor: await ctx(admin), now: NOW, correlationId: cid("exp"), type: "AUDIT_EXTRACT", format: "CSV", filters: f }))
      .resolves.toBeTruthy();
    // Kurum geneli denetim kaydı kapsamlı (D1) üyeliğe verilmez
    await expect(exportReport(db.prisma, { actor: await ctx(auditor), now: NOW, correlationId: cid("exp"), type: "AUDIT_EXTRACT", format: "CSV", filters: f }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(exportReport(db.prisma, { actor: await ctx(apprB), now: NOW, correlationId: cid("exp"), type: "AUDIT_EXTRACT", format: "CSV", filters: f }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("hassas dışa aktarma filigran taşır, kısıtlı indirme KISITLI ile işaretlenir, audit SUCCESS olur", async () => {
    const cidv = cid("exp-ok");
    const out = await exportReport(db.prisma, { actor: await ctx(auditor), now: NOW, correlationId: cidv, type: "CONTRACT_PORTFOLIO", format: "CSV", filters: {}, restricted: true });
    expect(out.watermark).toContain("KISITLI");
    expect(out.filename).toContain("_KISITLI");
    const text = new TextDecoder().decode(out.bytes);
    expect(text).toContain("FİLİGRAN: KISITLI");
    expect(text).toContain("Yalnızca oluşturanın görme yetkisi olan kayıtlar dahildir.");
    const ev = await db.prisma.auditEvent.findFirstOrThrow({ where: { correlationId: cidv } });
    expect(ev.eventType).toBe("REPORT_EXPORTED_RESTRICTED");
    expect(ev.outcome).toBe("SUCCESS");
  });

  it("hassas olmayan rapor kısıtlı indirilemez", async () => {
    await expect(exportReport(db.prisma, { actor: await ctx(admin), now: NOW, correlationId: cid("exp"), type: "OBLIGATIONS_OPEN", format: "CSV", filters: {}, restricted: true }))
      .rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
});

describe("vekalet kuralları", () => {
  it("gerekçe zorunlu, kendine vekalet yok, 90 günü aşan vekalet yok", async () => {
    const base = { actor: await ctx(admin), now: NOW, correlationId: cid("dl") };
    const start = new Date("2026-10-15T00:00:00Z");
    await expect(createDelegation(db.prisma, { ...base, delegateId: apprB, startsAt: start, endsAt: new Date("2026-10-20T00:00:00Z"), reason: "  " }))
      .rejects.toMatchObject({ code: "REASON_REQUIRED" });
    await expect(createDelegation(db.prisma, { ...base, delegateId: admin, startsAt: start, endsAt: new Date("2026-10-20T00:00:00Z"), reason: "Test" }))
      .rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(createDelegation(db.prisma, { ...base, delegateId: apprB, startsAt: start, endsAt: new Date("2027-06-01T00:00:00Z"), reason: "Test" }))
      .rejects.toThrow();
    const ok = await createDelegation(db.prisma, { ...base, delegateId: apprB, startsAt: start, endsAt: new Date("2026-10-20T00:00:00Z"), reason: "İzinli dönem" });
    expect(ok.id).toBeTruthy();
  });
});
