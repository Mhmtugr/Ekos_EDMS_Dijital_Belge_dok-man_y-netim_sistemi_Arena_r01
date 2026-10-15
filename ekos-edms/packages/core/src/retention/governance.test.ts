// Faz 4 saf kuralları birim testleri (I/O yok).
import { describe, expect, it } from "vitest";
import {
  addCalendarDuration,
  canCompleteOffboarding,
  checkDisposalApprovers,
  evaluateDisposalEligibility,
  profileDefinitionBlocks,
  resolveStartDate,
  validateBreakGlassDuration,
  type DisposalEligibilityInput,
  type RetentionProfileFacts,
} from "./governance.js";

const verified: RetentionProfileFacts = {
  exists: true,
  verifiedByLegal: true,
  startEvent: "CONTRACT_END",
  durationValue: 10,
  durationUnit: "CALENDAR_YEARS",
  disposalMethod: "DIGITAL_DELETE",
  disposalApproverCount: 2,
};

function input(over: Partial<DisposalEligibilityInput> = {}): DisposalEligibilityInput {
  return {
    profile: verified,
    startDate: "2015-06-01",
    today: "2026-10-14",
    legalHoldActive: false,
    activeContractExists: false,
    openObligationCount: 0,
    dependentRecordCount: 0,
    openApprovalCount: 0,
    auditReady: true,
    ...over,
  };
}

describe("addCalendarDuration", () => {
  it("ay sonu sabitlenir: 31 Ocak + 1 ay = 28 Şubat (artık yıl değilse)", () => {
    expect(addCalendarDuration("2027-01-31", 1, "CALENDAR_MONTHS")).toBe("2027-02-28");
  });
  it("artık yılda 31 Ocak + 1 ay = 29 Şubat", () => {
    expect(addCalendarDuration("2024-01-31", 1, "CALENDAR_MONTHS")).toBe("2024-02-29");
  });
  it("29 Şubat + 1 yıl = 28 Şubat", () => {
    expect(addCalendarDuration("2024-02-29", 1, "CALENDAR_YEARS")).toBe("2025-02-28");
  });
  it("yıl sınırını aşan ay toplamı doğru yıla geçer", () => {
    expect(addCalendarDuration("2020-11-15", 3, "CALENDAR_MONTHS")).toBe("2021-02-15");
  });
  it("gün eklemesi düz takvim günüdür (kaydırma yok)", () => {
    expect(addCalendarDuration("2026-10-10", 5, "CALENDAR_DAYS")).toBe("2026-10-15");
  });
  it("geçersiz tarih ve negatif süre reddedilir", () => {
    expect(() => addCalendarDuration("2026-02-30", 1, "CALENDAR_DAYS")).toThrow();
    expect(() => addCalendarDuration("2026-01-01", -1, "CALENDAR_DAYS")).toThrow();
  });
});

describe("başlangıç olayları", () => {
  const src = {
    documentCreatedDate: "2020-03-01",
    contractEndDate: "2024-12-31",
    fiscalYearEndDate: null,
    manualEventDate: "2025-07-07",
  };
  it("DOCUMENT_CREATED, CONTRACT_END, MANUAL_EVENT kendi kaynağını kullanır", () => {
    expect(resolveStartDate("DOCUMENT_CREATED", src)).toBe("2020-03-01");
    expect(resolveStartDate("CONTRACT_END", src)).toBe("2024-12-31");
    expect(resolveStartDate("MANUAL_EVENT", src)).toBe("2025-07-07");
  });
  it("FISCAL_YEAR_END kurum girmediyse çözülmez (uydurulmaz)", () => {
    expect(resolveStartDate("FISCAL_YEAR_END", src)).toBeNull();
    expect(resolveStartDate("FISCAL_YEAR_END", { ...src, fiscalYearEndDate: "2025-12-31" })).toBe("2025-12-31");
  });
  it("geçersiz tarih kaynağı çözülmüş sayılmaz", () => {
    expect(resolveStartDate("CONTRACT_END", { ...src, contractEndDate: "31.12.2024" })).toBeNull();
  });
});

describe("profil tanımı", () => {
  it("profil yoksa NO_RETENTION_PROFILE", () => {
    expect(profileDefinitionBlocks(null)).toEqual(["NO_RETENTION_PROFILE"]);
  });
  it("doğrulanmamış profil PROFILE_NOT_VERIFIED", () => {
    expect(profileDefinitionBlocks({ ...verified, verifiedByLegal: false })).toEqual(["PROFILE_NOT_VERIFIED"]);
  });
  it("süre sınırsızsa (durationValue null) profil eksik sayılır: imha asla yapılmaz", () => {
    expect(profileDefinitionBlocks({ ...verified, durationValue: null })).toEqual(["PROFILE_INCOMPLETE"]);
  });
  it("ayrılık ilkesi için iki onaycıdan azı PROFILE_INCOMPLETE", () => {
    expect(profileDefinitionBlocks({ ...verified, disposalApproverCount: 1 })).toEqual(["PROFILE_INCOMPLETE"]);
  });
  it("imha yöntemi boşsa eksik", () => {
    expect(profileDefinitionBlocks({ ...verified, disposalMethod: null })).toEqual(["PROFILE_INCOMPLETE"]);
  });
});

describe("imha uygunluğu", () => {
  it("süre dolmuş, temiz kayıt uygun ve vade tarihini döner", () => {
    const r = evaluateDisposalEligibility(input());
    expect(r.eligible).toBe(true);
    expect(r.dueDate).toBe("2025-06-01");
    expect(r.blocks).toEqual([]);
  });
  it("saklama süresi dolmamışsa RETENTION_NOT_EXPIRED", () => {
    const r = evaluateDisposalEligibility(input({ startDate: "2024-01-01" }));
    expect(r.eligible).toBe(false);
    expect(r.blocks).toContain("RETENTION_NOT_EXPIRED");
  });
  it("başlangıç olayı çözülmediyse START_EVENT_UNRESOLVED", () => {
    const r = evaluateDisposalEligibility(input({ startDate: null }));
    expect(r.blocks).toEqual(["START_EVENT_UNRESOLVED"]);
  });
  it("her engel tek tek ve birlikte raporlanır", () => {
    const r = evaluateDisposalEligibility(
      input({ legalHoldActive: true, activeContractExists: true, openObligationCount: 2, dependentRecordCount: 1, openApprovalCount: 1, auditReady: false }),
    );
    expect(r.eligible).toBe(false);
    expect(r.blocks).toEqual(
      expect.arrayContaining(["LEGAL_HOLD_ACTIVE", "ACTIVE_CONTRACT", "OPEN_OBLIGATION", "DEPENDENT_RECORD", "OPEN_APPROVAL", "AUDIT_INCOMPLETE"]),
    );
    expect(r.blocks).toHaveLength(6);
  });
  it("profil yokken süre hesabı yapılmaz ve uygun değildir", () => {
    const r = evaluateDisposalEligibility(input({ profile: null }));
    expect(r.eligible).toBe(false);
    expect(r.dueDate).toBeNull();
    expect(r.blocks).toEqual(["NO_RETENTION_PROFILE"]);
  });
});

describe("ayrılık ilkesi", () => {
  it("farklı iki kişi geçerli", () => {
    expect(checkDisposalApprovers({ reviewerId: "a", secondApproverId: "b" })).toEqual([]);
  });
  it("aynı kişi iki rolde ihlal", () => {
    expect(checkDisposalApprovers({ reviewerId: "a", secondApproverId: "a" })).toEqual(["SAME_PERSON"]);
  });
  it("eksik onaycı ihlal", () => {
    expect(checkDisposalApprovers({ reviewerId: null, secondApproverId: "b" })).toEqual(["REVIEWER_MISSING"]);
    expect(checkDisposalApprovers({ reviewerId: "a", secondApproverId: null })).toEqual(["SECOND_APPROVER_MISSING"]);
  });
});

describe("kırılma-cam süresi", () => {
  it("15–240 dakika aralığı kabul edilir", () => {
    expect(validateBreakGlassDuration(15)).toBe("OK");
    expect(validateBreakGlassDuration(240)).toBe("OK");
  });
  it("aralık dışı ve kesirli değer reddedilir", () => {
    expect(validateBreakGlassDuration(14)).toBe("DURATION_OUT_OF_RANGE");
    expect(validateBreakGlassDuration(241)).toBe("DURATION_OUT_OF_RANGE");
    expect(validateBreakGlassDuration(30.5)).toBe("DURATION_OUT_OF_RANGE");
  });
});

describe("personel ayrılışı tamamlama", () => {
  it("engelleyici modda açık kalem varsa tamamlanamaz", () => {
    expect(canCompleteOffboarding({ blockOnUnresolved: true, items: [{ status: "OPEN" }, { status: "TRANSFERRED" }] })).toEqual({
      ok: false, openCount: 1, warning: false,
    });
  });
  it("engellemeyen modda tamamlanır ama açık kalem uyarısı döner", () => {
    expect(canCompleteOffboarding({ blockOnUnresolved: false, items: [{ status: "OPEN" }] })).toEqual({
      ok: true, openCount: 1, warning: true,
    });
  });
  it("tüm kalemler devredilmiş/kapatılmışsa uyarısız tamamlanır", () => {
    expect(canCompleteOffboarding({ blockOnUnresolved: true, items: [{ status: "TRANSFERRED" }, { status: "WAIVED" }] })).toEqual({
      ok: true, openCount: 0, warning: false,
    });
  });
});
