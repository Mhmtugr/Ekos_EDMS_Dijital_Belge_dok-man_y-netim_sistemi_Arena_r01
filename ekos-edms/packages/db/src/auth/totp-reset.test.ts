// reset-totp mantığı (GERÇEK PostgreSQL): sır ve etkinleşme temizlenir, denetim kaydı yazılır, yoksa hata.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDb, type TestDb } from "../testing/pg-harness.js";
import { resetTotpForEmail } from "./totp-reset.js";

let db: TestDb;
beforeAll(async () => {
  db = await startTestDb();
  await db.prisma.user.create({
    data: { email: "totp-reset@t.test", displayName: "R", totpSecretCipher: "cipher", totpEnabledAt: new Date(), updatedAt: new Date() },
  });
});
afterAll(async () => db.stop());

describe("resetTotpForEmail", () => {
  it("etkin TOTP'yi kapatır ve denetim kaydı yazar", async () => {
    const r = await resetTotpForEmail(db.prisma, "  TOTP-Reset@t.test ");
    expect(r.wasEnabled).toBe(true);
    const u = await db.prisma.user.findUniqueOrThrow({ where: { email: "totp-reset@t.test" } });
    expect(u.totpSecretCipher).toBeNull();
    expect(u.totpEnabledAt).toBeNull();
    const audit = await db.prisma.auditEvent.count({ where: { eventType: "TOTP_RESET_CLI", targetId: u.id } });
    expect(audit).toBe(1);
  });
  it("bilinmeyen e-posta hata verir", async () => {
    await expect(resetTotpForEmail(db.prisma, "yok@t.test")).rejects.toThrow("Kullanıcı bulunamadı");
  });
  it("boş e-posta hata verir", async () => {
    await expect(resetTotpForEmail(db.prisma, "  ")).rejects.toThrow("EKOS_EMAIL zorunlu");
  });
});
