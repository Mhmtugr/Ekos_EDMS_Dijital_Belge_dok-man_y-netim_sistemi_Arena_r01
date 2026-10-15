// TOTP ikinci faktör testleri (GERÇEK PostgreSQL): kurulum, onay, giriş, tekrar kullanım, anahtar yokluğu, şifreleme.
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { totpAt, base32Decode } from "@ekos/core";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import { startTestDb, type TestDb } from "../testing/pg-harness.js";
import { authenticateLocal, type PasswordHasher } from "./local.js";
import { beginTotpEnrollment, confirmTotpEnrollment, decryptSecret, encryptSecret, parseTotpKey } from "./totp.js";

const hasher: PasswordHasher = { hash: (p) => argonHash(p), verify: (h, p) => argonVerify(h, p) };
const PASSWORD = "Güçlü-Parola-2026!";
const KEY = randomBytes(32);
const OTHER_KEY = randomBytes(32);
let db: TestDb;
let userId: string;

beforeAll(async () => {
  db = await startTestDb();
  userId = (await db.prisma.user.create({ data: { email: "totp@ekos.test", displayName: "T", passwordHash: await hasher.hash(PASSWORD), updatedAt: new Date() } })).id;
});
afterAll(async () => {
  await db.stop();
});

const codeAt = (secretB32: string, at: Date): string => totpAt(base32Decode(secretB32), Math.floor(at.getTime() / 1000));
const login = (now: Date, extra: { totpKey?: Buffer | null; totpCode?: string | null } = {}) =>
  authenticateLocal(db.prisma, { email: "totp@ekos.test", password: PASSWORD, now, correlationId: "t", hasher, ...extra });

describe("TOTP şifreleme", () => {
  it("şifrele/çöz geri dönüşlüdür; yanlış anahtar çözemez", () => {
    const secret = randomBytes(20);
    const c = encryptSecret(KEY, secret);
    expect(Buffer.from(decryptSecret(KEY, c))).toEqual(Buffer.from(secret));
    expect(() => decryptSecret(OTHER_KEY, c)).toThrow();
  });
  it("anahtar 32 bayt base64 değilse reddedilir", () => {
    expect(parseTotpKey(undefined)).toBeNull();
    expect(parseTotpKey("kısa")).toBeNull();
    expect(parseTotpKey(KEY.toString("base64"))?.length).toBe(32);
  });
});

describe("TOTP kurulum ve giriş", () => {
  const t0 = new Date("2026-10-13T10:00:00Z");
  let secretB32 = "";

  it("kurulum sırrı üretir; hesap henüz etkin değildir", async () => {
    const r = await beginTotpEnrollment(db.prisma, { userId, key: KEY, now: t0, correlationId: "e1" });
    if (r === "ALREADY_ENABLED") throw new Error("beklenmedik");
    secretB32 = r.secretBase32;
    expect(r.otpauthUri.startsWith("otpauth://totp/")).toBe(true);
    const u = await db.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(u.totpEnabledAt).toBeNull();
    expect(u.totpSecretCipher).toContain("v1:");
    expect(u.totpSecretCipher).not.toContain(secretB32);
  });

  it("yanlış kodla onay reddedilir; etkinleşmez", async () => {
    expect(await confirmTotpEnrollment(db.prisma, { userId, key: KEY, code: "000000", now: t0, correlationId: "e2" })).toBe("INVALID_CODE");
    expect((await db.prisma.user.findUniqueOrThrow({ where: { id: userId } })).totpEnabledAt).toBeNull();
  });

  it("doğru kodla onay etkinleştirir", async () => {
    expect(await confirmTotpEnrollment(db.prisma, { userId, key: KEY, code: codeAt(secretB32, t0), now: t0, correlationId: "e3" })).toBe("OK");
    expect((await db.prisma.user.findUniqueOrThrow({ where: { id: userId } })).totpEnabledAt).not.toBeNull();
  });

  it("etkin hesapta yeniden kurulum reddedilir", async () => {
    expect(await beginTotpEnrollment(db.prisma, { userId, key: KEY, now: t0, correlationId: "e4" })).toBe("ALREADY_ENABLED");
  });

  it("parola doğru, kod yok → TOTP_REQUIRED; sayaç artmaz", async () => {
    const before = (await db.prisma.user.findUniqueOrThrow({ where: { id: userId } })).failedLoginCount;
    const r = await login(t0, { totpKey: KEY });
    expect(r).toEqual({ ok: false, reason: "TOTP_REQUIRED" });
    expect((await db.prisma.user.findUniqueOrThrow({ where: { id: userId } })).failedLoginCount).toBe(before);
  });

  it("anahtar yapılandırılmamışsa giriş yapılamaz (sessiz atlama yok)", async () => {
    const r = await login(t0, { totpKey: null, totpCode: codeAt(secretB32, t0) });
    expect(r).toEqual({ ok: false, reason: "TOTP_NOT_CONFIGURED" });
  });

  it("yanlış kod → INVALID_CREDENTIALS ve sayaç artar", async () => {
    const before = (await db.prisma.user.findUniqueOrThrow({ where: { id: userId } })).failedLoginCount;
    const r = await login(t0, { totpKey: KEY, totpCode: "123456" });
    expect(r.ok).toBe(false);
    expect((await db.prisma.user.findUniqueOrThrow({ where: { id: userId } })).failedLoginCount).toBe(before + 1);
  });

  it("doğru kod → oturum açılır; aynı kod ikinci kez kullanılamaz (tekrar koruması)", async () => {
    const t1 = new Date(t0.getTime() + 120_000);
    const code = codeAt(secretB32, t1);
    const ok = await login(t1, { totpKey: KEY, totpCode: code });
    expect(ok.ok).toBe(true);
    const again = await login(t1, { totpKey: KEY, totpCode: code });
    expect(again.ok).toBe(false);
  });
});

// Faz 7: AES-256-GCM sır şifresi bütünlüğü (bozulma ve kısa etiket reddi).
describe("TOTP sır şifresi bütünlüğü", () => {
  it("değiştirilmiş şifreli metin çözülmez", () => {
    const key = Buffer.alloc(32, 9);
    const enc = encryptSecret(key, new TextEncoder().encode("GIZLI-SIR-123"));
    const [v, iv, tag, ct] = enc.split(":") as [string, string, string, string];
    const flipped = Buffer.from(ct, "base64");
    flipped[0] = (flipped[0] ?? 0) ^ 0x01;
    expect(() => decryptSecret(key, [v, iv, tag, flipped.toString("base64")].join(":"))).toThrow();
  });
  it("kısa doğrulama etiketi reddedilir", () => {
    const key = Buffer.alloc(32, 9);
    const enc = encryptSecret(key, new TextEncoder().encode("X"));
    const [v, iv, , ct] = enc.split(":") as [string, string, string, string];
    expect(() => decryptSecret(key, [v, iv, Buffer.alloc(8).toString("base64"), ct].join(":"))).toThrow(/etiket/);
  });
  it("doğru anahtar ve bozulmamış metin geri çözülür", () => {
    const key = Buffer.alloc(32, 9);
    const enc = encryptSecret(key, new TextEncoder().encode("GIZLI-SIR-123"));
    expect(new TextDecoder().decode(decryptSecret(key, enc))).toBe("GIZLI-SIR-123");
  });
});
