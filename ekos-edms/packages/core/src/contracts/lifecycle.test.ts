import { describe, expect, it } from "vitest";
import { checkContractTransition, CONTRACT_TRANSITIONS, type ContractTransitionContext } from "./lifecycle.js";
import { CONTRACT_LIFECYCLE_STATUSES } from "../states/index.js";

const OK: ContractTransitionContext = { origin: "MANUAL", allApprovalsCompleted: true, hasSignatureEvidence: true };

describe("R-LC-02 geçiş tablosu", () => {
  it("her durum tabloda tanımlı ve hedefler geçerli durumlar", () => {
    for (const s of CONTRACT_LIFECYCLE_STATUSES) {
      expect(CONTRACT_TRANSITIONS[s]).toBeDefined();
      for (const t of CONTRACT_TRANSITIONS[s]) expect(CONTRACT_LIFECYCLE_STATUSES).toContain(t);
    }
  });
  it("tabloda olmayan geçiş reddedilir (DRAFT → ACTIVE)", () => {
    expect(checkContractTransition("DRAFT", "ACTIVE", OK)).toEqual({ ok: false, violation: "TRANSITION_NOT_ALLOWED" });
  });
  it("DISPOSED'dan hiçbir yere geçilmez", () => {
    expect(checkContractTransition("DISPOSED", "ARCHIVED", OK).ok).toBe(false);
  });
});

describe("R-LC-03 onaylar olmadan READY_FOR_SIGNATURE yok", () => {
  it("onaylar eksikken reddedilir", () => {
    expect(
      checkContractTransition("PENDING_APPROVAL", "READY_FOR_SIGNATURE", { ...OK, allApprovalsCompleted: false }),
    ).toEqual({ ok: false, violation: "APPROVALS_INCOMPLETE" });
  });
  it("tüm onaylar tamamlanınca kabul edilir", () => {
    expect(checkContractTransition("PENDING_APPROVAL", "READY_FOR_SIGNATURE", OK)).toEqual({ ok: true });
  });
});

describe("R-LC-04 imza kanıtı olmadan ACTIVE yok", () => {
  it("kanıt yoksa reddedilir", () => {
    expect(
      checkContractTransition("PENDING_SIGNATURE", "ACTIVE", { ...OK, hasSignatureEvidence: false }),
    ).toEqual({ ok: false, violation: "SIGNATURE_EVIDENCE_MISSING" });
  });
  it("kanıt varsa kabul edilir", () => {
    expect(checkContractTransition("PENDING_SIGNATURE", "ACTIVE", OK)).toEqual({ ok: true });
  });
});

describe("R-LC-06 geçmiş kayıt onay gibi gösterilmez", () => {
  const H: ContractTransitionContext = { ...OK, origin: "IMPORTED_HISTORICAL" };
  it("geçmiş kayıt READY/SIGNATURE/ACTIVE'e girmez", () => {
    expect(checkContractTransition("PENDING_APPROVAL", "READY_FOR_SIGNATURE", H).ok).toBe(false);
    expect(checkContractTransition("PENDING_SIGNATURE", "ACTIVE", H)).toEqual({ ok: false, violation: "HISTORICAL_NOT_APPROVABLE" });
  });
  it("geçmiş kayıt arşive alınabilir", () => {
    expect(checkContractTransition("ACTIVE", "EXPIRED", H)).toEqual({ ok: true });
  });
});

describe("INVALID yalnız yetkili ve gerekçeli", () => {
  it("yetkisiz INVALID reddedilir", () => {
    expect(checkContractTransition("ACTIVE", "INVALID", OK)).toEqual({ ok: false, violation: "INVALID_REQUIRES_AUTHORITY_AND_REASON" });
  });
  it("yetkili INVALID kabul edilir", () => {
    expect(checkContractTransition("ACTIVE", "INVALID", { ...OK, invalidWithAuthorityAndReason: true })).toEqual({ ok: true });
  });
});
