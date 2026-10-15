import { describe, expect, it } from "vitest";
import { computeNoticeDeadline, computeRenewalReviewDate } from "./renewal.js";

const VERIFIED = { verified: true, noticeValue: 30, noticeUnit: "CALENDAR_DAYS" as const };

describe("R-RNW-01 yenileme/ihbar tarihi", () => {
  it("doğrulanmamış kural → NEEDS_MANUAL_VERIFICATION (tarih üretilmez)", () => {
    expect(computeNoticeDeadline("2027-03-31", { ...VERIFIED, verified: false })).toBe("NEEDS_MANUAL_VERIFICATION");
  });
  it("bitiş tarihi yok → NEEDS_MANUAL_VERIFICATION", () => {
    expect(computeNoticeDeadline(null, VERIFIED)).toBe("NEEDS_MANUAL_VERIFICATION");
  });
  it("geçersiz takvim tarihi (2027-02-30) → NEEDS_MANUAL_VERIFICATION", () => {
    expect(computeNoticeDeadline("2027-02-30", VERIFIED)).toBe("NEEDS_MANUAL_VERIFICATION");
  });
  it("kural eksik (süre birimi yok) → NEEDS_MANUAL_VERIFICATION", () => {
    expect(computeNoticeDeadline("2027-03-31", { verified: true, noticeValue: 30, noticeUnit: null })).toBe("NEEDS_MANUAL_VERIFICATION");
  });
  it("doğrulanmış gün kuralı: 31 Mart − 30 gün = 1 Mart", () => {
    expect(computeNoticeDeadline("2027-03-31", VERIFIED)).toBe("2027-03-01");
  });
  it("doğrulanmış ay kuralı: 31 Mart − 1 ay = 28 Şubat (yıl içi)", () => {
    expect(computeNoticeDeadline("2027-03-31", { verified: true, noticeValue: 1, noticeUnit: "CALENDAR_MONTHS" })).toBe("2027-02-28");
  });
  it("ay kuralı yıl sınırını geçer: 15 Ocak − 2 ay = 15 Kasım önceki yıl", () => {
    expect(computeNoticeDeadline("2027-01-15", { verified: true, noticeValue: 2, noticeUnit: "CALENDAR_MONTHS" })).toBe("2026-11-15");
  });
  it("NO_RENEW için yenileme tarihi yoktur", () => {
    expect(computeRenewalReviewDate("2027-03-31", "NO_RENEW", VERIFIED)).toBeNull();
  });
});
