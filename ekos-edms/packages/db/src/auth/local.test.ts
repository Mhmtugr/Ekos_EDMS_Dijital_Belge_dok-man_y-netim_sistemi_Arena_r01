// Yerel kimlik modu testleri (GERÇEK PostgreSQL). Kilitleme, tek tip hata, oturum özeti, çıkış, süre dolumu.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDb, type TestDb } from "../testing/pg-harness.js";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import { authenticateLocal, hashToken, logout, resolveSession, SESSION_TTL_MS, type PasswordHasher } from "./local.js";

const hasher: PasswordHasher = { hash: (p) => argonHash(p), verify: (h, p) => argonVerify(h, p) };
const hashPassword = (p: string) => hasher.hash(p);

const PASSWORD = "Güçlü-Parola-2026!";
const T0 = new Date("2026-10-13T09:00:00Z");
let db: TestDb;
let activeId: string;
let disabledId: string;

beforeAll(async () => {
  db = await startTestDb();
  const p = db.prisma;
  activeId = (await p.user.create({ data: { email: "ali@ekos.test", displayName: "Ali", passwordHash: await hashPassword(PASSWORD), updatedAt: T0 } })).id;
  disabledId = (await p.user.create({ data: { email: "pasif@ekos.test", displayName: "Pasif", status: "DISABLED", passwordHash: await hashPassword(PASSWORD), updatedAt: T0 } })).id;
});

afterAll(async () => {
  await db.stop();
});

const login = (email: string, password: string, now: Date, cid = "L") =>
  authenticateLocal(db.prisma, { email, password, now, correlationId: cid, hasher });

describe("yerel giriş", () => {
  it("doğru parola: belirteç döner; veritabanında yalnızca özet var", async () => {
    const r = await login("ali@ekos.test", PASSWORD, T0, "ok1");
    if (!r.ok) throw new Error("giriş başarısız");
    const rows = await db.prisma.authSession.findMany({ where: { userId: activeId } });
    expect(rows.some((s) => s.tokenHash === hashToken(r.token))).toBe(true);
    expect(rows.some((s) => s.tokenHash === r.token)).toBe(false);
    expect(r.expiresAt.getTime() - T0.getTime()).toBe(SESSION_TTL_MS);
    const actor = await resolveSession(db.prisma, r.token, T0);
    expect(actor?.userId).toBe(activeId);
  });

  it("yanlış parola, bilinmeyen e-posta ve pasif hesap aynı tek tip hatayı verir", async () => {
    expect(await login("ali@ekos.test", "yanlis-parola-xyz", T0, "bad1")).toEqual({ ok: false, reason: "INVALID_CREDENTIALS" });
    expect(await login("yok@ekos.test", PASSWORD, T0, "bad2")).toEqual({ ok: false, reason: "INVALID_CREDENTIALS" });
    expect(await login("pasif@ekos.test", PASSWORD, T0, "bad3")).toEqual({ ok: false, reason: "INVALID_CREDENTIALS" });
    const pasif = await db.prisma.user.findUniqueOrThrow({ where: { id: disabledId } });
    expect(pasif.failedLoginCount).toBe(0);
  });

  it("beş başarısız denemeden sonra hesap kilitlenir; kilit süresince doğru parola da reddedilir", async () => {
    const email = "kilit@ekos.test";
    await db.prisma.user.create({ data: { email, displayName: "K", passwordHash: await hashPassword(PASSWORD), updatedAt: T0 } });
    for (let i = 0; i < 5; i++) await login(email, "yanlis-parola-xyz", T0, `k${String(i)}`);
    const u = await db.prisma.user.findUniqueOrThrow({ where: { email } });
    expect(u.lockedUntil).not.toBeNull();
    expect(await login(email, PASSWORD, new Date(T0.getTime() + 60_000), "k-locked")).toEqual({ ok: false, reason: "INVALID_CREDENTIALS" });
    const after = new Date(T0.getTime() + 16 * 60_000);
    const r = await login(email, PASSWORD, after, "k-after");
    expect(r.ok).toBe(true);
  });
});

describe("oturum yaşam döngüsü", () => {
  it("süresi dolan oturum geçersizdir", async () => {
    const r = await login("ali@ekos.test", PASSWORD, T0, "exp1");
    if (!r.ok) throw new Error("giriş");
    expect(await resolveSession(db.prisma, r.token, new Date(T0.getTime() + SESSION_TTL_MS + 1))).toBeNull();
  });

  it("çıkış oturumu iptal eder", async () => {
    const r = await login("ali@ekos.test", PASSWORD, T0, "out1");
    if (!r.ok) throw new Error("giriş");
    await logout(db.prisma, r.token, T0);
    expect(await resolveSession(db.prisma, r.token, T0)).toBeNull();
  });

  it("pasif kullanıcının mevcut oturumu da geçersiz olur", async () => {
    const u = await db.prisma.user.create({ data: { email: "sonra@ekos.test", displayName: "S", passwordHash: await hashPassword(PASSWORD), updatedAt: T0 } });
    const r = await login("sonra@ekos.test", PASSWORD, T0, "dis1");
    if (!r.ok) throw new Error("giriş");
    await db.prisma.user.update({ where: { id: u.id }, data: { status: "DISABLED" } });
    expect(await resolveSession(db.prisma, r.token, T0)).toBeNull();
  });

  it("kısa veya uydurma belirteç reddedilir", async () => {
    expect(await resolveSession(db.prisma, "kisa", T0)).toBeNull();
    expect(await resolveSession(db.prisma, "a".repeat(40), T0)).toBeNull();
  });
});
