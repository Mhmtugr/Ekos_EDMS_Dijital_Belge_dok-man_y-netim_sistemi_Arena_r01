// Sistem ayarları entegrasyon testleri (GERÇEK PostgreSQL): kritik ayar ikinci onay akışı, sürüm çakışması, doğrulama.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** Test yardımcısı: beklenen değer yoksa açık hata (non-null assertion yerine). */
function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error("beklenen değer yok");
  return v;
}
import { loadActorContext } from "../actor.js";
import { startTestDb, type TestDb } from "../testing/pg-harness.js";
import { approveSettingChange, cancelSettingChange, listSettings, saveSetting } from "./settings.js";

const NOW = new Date("2026-10-14T06:00:00Z");
const EMPTY_SCOPE = { departmentIds: [], documentTypeIds: [], counterpartyIds: [], projectIds: [], updatedAt: NOW };
let db: TestDb;
let adminA: string;
let adminB: string;
let plain: string;
let seq = 0;
const cid = () => `st-${String(++seq)}`;

async function errCode(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as { code?: string }).code ?? "UNKNOWN";
  }
  return "NO_ERROR";
}

beforeAll(async () => {
  db = await startTestDb();
  const p = db.prisma;
  await p.permission.createMany({ data: [{ code: "config.manage", description: "x" }, { code: "document.list", description: "x" }] });
  const perms = await p.permission.findMany();
  const pid = (c: string) => must(perms.find((x) => x.code === c)).id;
  const r1 = await p.role.create({ data: { code: "R_CFG", name: "cfg", updatedAt: NOW } });
  await p.rolePermission.create({ data: { roleId: r1.id, permissionId: pid("config.manage") } });
  const r2 = await p.role.create({ data: { code: "R_LIST", name: "list", updatedAt: NOW } });
  await p.rolePermission.create({ data: { roleId: r2.id, permissionId: pid("document.list") } });
  const u = async (tag: string) => (await p.user.create({ data: { email: `${tag}@s.test`, displayName: tag, updatedAt: NOW } })).id;
  adminA = await u("cfg-a");
  adminB = await u("cfg-b");
  plain = await u("plain");
  await p.membership.create({ data: { userId: adminA, roleId: r1.id, ...EMPTY_SCOPE } as never });
  await p.membership.create({ data: { userId: adminB, roleId: r1.id, ...EMPTY_SCOPE } as never });
  await p.membership.create({ data: { userId: plain, roleId: r2.id, ...EMPTY_SCOPE } as never });
});

afterAll(async () => {
  await db.stop();
});

const ctx = (id: string) => loadActorContext(db.prisma, id, NOW);

describe("kritik ayar ikinci onay akışı", () => {
  it("kritik ayar önerilir (PENDING), yürürlüğe girmez; öneren kişi onaylayamaz", async () => {
    const a = await ctx(adminA);
    const r = await saveSetting(db.prisma, { actor: a, now: NOW, correlationId: cid(), key: "notifications.teams", value: { enabled: true, secretRef: "TEAMS_WEBHOOK_URL" }, expectedRowVersion: 0 });
    expect(r.status).toBe("PENDING_SECOND_APPROVAL");
    const before = (await listSettings(db.prisma, { actor: a, now: NOW })).find((s) => s.key === "notifications.teams");
    expect(before?.current).toBeNull();
    expect(before?.status).toBe("UNVERIFIED");
    expect(await errCode(approveSettingChange(db.prisma, { actor: a, now: NOW, correlationId: cid(), key: "notifications.teams", expectedRowVersion: r.rowVersion }))).toBe("DECISION_DENIED");
  });

  it("ikinci config yöneticisi onaylayınca ayar uygulanır ve denetim izi yazılır", async () => {
    const a = await ctx(adminA);
    const b = await ctx(adminB);
    const views = await listSettings(db.prisma, { actor: a, now: NOW });
    const ver = must(views.find((s) => s.key === "notifications.teams")).rowVersion;
    const r = await approveSettingChange(db.prisma, { actor: b, now: NOW, correlationId: cid(), key: "notifications.teams", expectedRowVersion: ver });
    expect(r.rowVersion).toBe(ver + 1);
    const after = (await listSettings(db.prisma, { actor: b, now: NOW })).find((s) => s.key === "notifications.teams");
    expect(after?.status).toBe("COMPLETED");
    expect(after?.current).toEqual({ enabled: true, secretRef: "TEAMS_WEBHOOK_URL" });
    const audit = await db.prisma.auditEvent.findFirst({ where: { eventType: "SETTING_CHANGE_APPROVED", outcome: "SUCCESS" } });
    expect(audit).not.toBeNull();
  });

  it("eski sürüm numarasıyla öneri/onay VERSION_CONFLICT verir", async () => {
    const a = await ctx(adminA);
    expect(await errCode(saveSetting(db.prisma, { actor: a, now: NOW, correlationId: cid(), key: "notifications.teams", value: { enabled: false, secretRef: "TEAMS_WEBHOOK_URL" }, expectedRowVersion: 0 }))).toBe("VERSION_CONFLICT");
  });

  it("iptal bekleyen öneriyi kaldırır; onay bekleyen yoksa onay reddedilir", async () => {
    const a = await ctx(adminA);
    const b = await ctx(adminB);
    const ver = must((await listSettings(db.prisma, { actor: a, now: NOW })).find((s) => s.key === "notifications.email")).rowVersion;
    await saveSetting(db.prisma, { actor: a, now: NOW, correlationId: cid(), key: "notifications.email", value: { enabled: true, secretRef: "SMTP_URL", from: "ekos@ornek.com.tr" }, expectedRowVersion: ver });
    const v2 = must((await listSettings(db.prisma, { actor: a, now: NOW })).find((s) => s.key === "notifications.email")).rowVersion;
    await cancelSettingChange(db.prisma, { actor: b, now: NOW, correlationId: cid(), key: "notifications.email", expectedRowVersion: v2 });
    const v3 = must((await listSettings(db.prisma, { actor: a, now: NOW })).find((s) => s.key === "notifications.email")).rowVersion;
    expect(await errCode(approveSettingChange(db.prisma, { actor: b, now: NOW, correlationId: cid(), key: "notifications.email", expectedRowVersion: v3 }))).toBe("SETTING_STATE_INVALID");
  });
});

describe("ayar doğrulaması ve yetki", () => {
  it("geçersiz hatırlatma aralığı VALIDATION_FAILED verir", async () => {
    const a = await ctx(adminA);
    expect(await errCode(saveSetting(db.prisma, { actor: a, now: NOW, correlationId: cid(), key: "reminders.offsetDays", value: { offsets: [0, 400] }, expectedRowVersion: 0 }))).toBe("VALIDATION_FAILED");
    expect(await errCode(saveSetting(db.prisma, { actor: a, now: NOW, correlationId: cid(), key: "reminders.offsetDays", value: { offsets: [90, 90] }, expectedRowVersion: 0 }))).toBe("VALIDATION_FAILED");
  });

  it("hatırlatma aralığı (kritik değil) doğrudan uygulanır ve sıralanır", async () => {
    const a = await ctx(adminA);
    const r = await saveSetting(db.prisma, { actor: a, now: NOW, correlationId: cid(), key: "reminders.offsetDays", value: { offsets: [7, 30, 1] }, expectedRowVersion: 0 });
    expect(r.status).toBe("APPLIED");
    const v = (await listSettings(db.prisma, { actor: a, now: NOW })).find((s) => s.key === "reminders.offsetDays");
    expect(v?.current).toEqual({ offsets: [30, 7, 1] });
  });

  it("config.manage olmayan kullanıcı ayarları listeleyemez ve kaydedemez", async () => {
    const pl = await ctx(plain);
    expect(await errCode(listSettings(db.prisma, { actor: pl, now: NOW }))).not.toBe("NO_ERROR");
    expect(await errCode(saveSetting(db.prisma, { actor: pl, now: NOW, correlationId: cid(), key: "reminders.offsetDays", value: { offsets: [30] }, expectedRowVersion: 1 }))).not.toBe("NO_ERROR");
  });
});
