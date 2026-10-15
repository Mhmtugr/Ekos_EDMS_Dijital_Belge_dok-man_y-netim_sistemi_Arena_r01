import { describe, expect, it } from "vitest";
import { checkApprovalDecision, checkApprovalMatrix } from "./rules.js";

const A = "11111111-1111-7111-8111-111111111111";
const B = "22222222-2222-7222-8222-222222222222";

describe("R-WF-02 onay matrisi", () => {
  it("boş matris reddedilir", () => {
    expect(checkApprovalMatrix([])).toEqual({ ok: false, violation: "NO_APPROVAL_MATRIX" });
  });
  it("onaycısız adım reddedilir", () => {
    expect(checkApprovalMatrix([{ orderIndex: 1, approverIds: [], requiredApprovals: 1 }])).toEqual({ ok: false, violation: "STEP_WITHOUT_APPROVER" });
  });
  it("gereken onay sayısı onaycı sayısını aşamaz", () => {
    expect(checkApprovalMatrix([{ orderIndex: 1, approverIds: [A], requiredApprovals: 2 }])).toEqual({ ok: false, violation: "INVALID_REQUIRED_APPROVALS" });
  });
  it("geçerli matris kabul edilir", () => {
    expect(checkApprovalMatrix([{ orderIndex: 1, approverIds: [A, B], requiredApprovals: 1 }])).toEqual({ ok: true });
  });
});

describe("R-WF-03 kendi onayını engelleme", () => {
  it("başlatan kişi kendi görevini onaylayamaz (varsayılan)", () => {
    expect(checkApprovalDecision("APPROVE", null, { actorId: A, taskAssigneeId: A, initiatorId: A })).toEqual({ ok: false, violation: "SELF_APPROVAL_BLOCKED" });
  });
  it("kurum politikası izin verirse kabul edilir", () => {
    expect(checkApprovalDecision("APPROVE", null, { actorId: A, taskAssigneeId: A, initiatorId: A, allowSelfApproval: true })).toEqual({ ok: true });
  });
  it("görev sahibi olmayan karar veremez", () => {
    expect(checkApprovalDecision("APPROVE", null, { actorId: B, taskAssigneeId: A, initiatorId: A })).toEqual({ ok: false, violation: "NOT_ASSIGNEE" });
  });
});

describe("R-DB-05 red/geri gönderme gerekçesi", () => {
  it("gerekçesiz RED reddedilir; boşluk da gerekçe sayılmaz", () => {
    expect(checkApprovalDecision("REJECT", "   ", { actorId: A, taskAssigneeId: A, initiatorId: B })).toEqual({ ok: false, violation: "REASON_REQUIRED" });
    expect(checkApprovalDecision("RETURN", null, { actorId: A, taskAssigneeId: A, initiatorId: B })).toEqual({ ok: false, violation: "REASON_REQUIRED" });
  });
  it("gerekçeli RED kabul edilir; onayda gerekçe gerekmez", () => {
    expect(checkApprovalDecision("REJECT", "Fiyat eksik", { actorId: A, taskAssigneeId: A, initiatorId: B })).toEqual({ ok: true });
    expect(checkApprovalDecision("APPROVE", null, { actorId: A, taskAssigneeId: A, initiatorId: B })).toEqual({ ok: true });
  });
});
