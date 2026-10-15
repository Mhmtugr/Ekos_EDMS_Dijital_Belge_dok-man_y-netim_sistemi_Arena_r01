import { describe, expect, it } from "vitest";
import { evaluateAutoDisposal } from "./disposal-gate.js";

const GOOD = { verifiedByLegal: true, startEvent: "CONTRACT_END", durationValue: 10 };

describe("otomatik imha kapısı (bu sürümde kapalı)", () => {
  it("en iyi girdiyle bile izin vermez", () => {
    const r = evaluateAutoDisposal({ profile: GOOD, legalHoldActive: false });
    expect(r.allowed).toBe(false);
    expect(r.blocks).toEqual(["AUTO_DISPOSAL_DISABLED"]);
  });
  it("profil yok, doğrulanmamış, bekletme var → tüm nedenler listelenir", () => {
    expect(evaluateAutoDisposal({ profile: null, legalHoldActive: false }).blocks).toContain("NO_RETENTION_PROFILE");
    const r = evaluateAutoDisposal({ profile: { ...GOOD, verifiedByLegal: false, startEvent: null, durationValue: null }, legalHoldActive: true });
    expect(r.allowed).toBe(false);
    expect(r.blocks).toEqual(expect.arrayContaining(["PROFILE_NOT_VERIFIED", "PROFILE_START_EVENT_MISSING", "LEGAL_HOLD_ACTIVE"]));
  });
});
