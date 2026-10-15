// Faz 7: SMTP göndericisi güvenlik testleri. Gerçek SMTP sunucusu yoktur; yalnız ağ çağrısı YAPMAYAN denetimler.
import { describe, expect, it } from "vitest";
import { SmtpSender } from "./smtp.js";

describe("SmtpSender (ağ çağrısı yapmayan denetimler)", () => {
  it("geçersiz alıcı adresinde ağa çıkmadan FAILED döner", async () => {
    const s = new SmtpSender("smtp://127.0.0.1:1", "ekos@ekos.local");
    const r = await s.send({ to: "gecersiz-adres", subject: "x", body: "y", recipientName: "Ad" });
    expect(r).toEqual({ status: "FAILED", errorCode: "NO_RECIPIENT_ADDRESS", errorMessage: "Alıcının geçerli e-posta adresi yok" });
  });
  it("hata mesajı sunucu ayrıntısını (kimlik bilgisi olabilir) sızdırmaz", async () => {
    const s = new SmtpSender("smtp://user:gizli-parola@127.0.0.1:1", "ekos@ekos.local");
    const r = await s.send({ to: "a@b.test", subject: "x", body: "y", recipientName: "Ad" });
    expect(r.status).toBe("FAILED");
    expect(JSON.stringify(r)).not.toContain("gizli-parola");
  });
});
