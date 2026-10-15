import { describe, expect, it } from "vitest";
import { API_ERROR_STATUS, statusFor, toApiError, type ApiErrorCode } from "./api-error.js";

describe("standart hata biçimi", () => {
  it("yalnızca code, message, correlationId alanlarını döner", () => {
    const body = toApiError("NOT_FOUND", "corr-1");
    expect(Object.keys(body).sort()).toEqual(["code", "correlationId", "message"]);
    expect(body.correlationId).toBe("corr-1");
  });

  it("mesajlar güvenli Türkçe metindir ve iç ayrıntı içermez", () => {
    const body = toApiError("INTERNAL", "c");
    expect(body.message).toBe("Beklenmeyen bir hata oluştu.");
    expect(body.message).not.toMatch(/stack|sql|prisma|secret/i);
  });

  it("her kodun HTTP durumu 4xx/5xx aralığında ve statusFor ile tutarlı", () => {
    for (const [code, status] of Object.entries(API_ERROR_STATUS) as [ApiErrorCode, number][]) {
      expect(status, code).toBeGreaterThanOrEqual(400);
      expect(status, code).toBeLessThan(600);
      expect(statusFor(code)).toBe(status);
    }
  });

  it("giriş hatası kullanıcı varlığını sızdırmaz (tek mesaj)", () => {
    expect(toApiError("INVALID_CREDENTIALS", "c").message).toBe("Kullanıcı adı veya parola hatalı.");
  });
});
