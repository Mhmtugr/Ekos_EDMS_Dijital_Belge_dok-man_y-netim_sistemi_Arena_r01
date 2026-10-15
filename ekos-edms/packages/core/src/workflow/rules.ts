// İş akışı kuralları (Faz 3). Saf fonksiyonlar.
// R-WF-02: onay matrisi yoksa akış başlatılamaz.
// R-WF-03: başlatan kişi kendi onayını veremez (yapılandırılabilir; varsayılan KAPALI-İZİN = engelli).
// R-DB-05: RED ve GERİ GÖNDERME kararında gerekçe zorunludur.

export interface MatrixStep {
  readonly orderIndex: number;
  readonly approverIds: readonly string[];
  readonly requiredApprovals: number;
}

export type WorkflowViolation =
  | "NO_APPROVAL_MATRIX"
  | "STEP_WITHOUT_APPROVER"
  | "INVALID_REQUIRED_APPROVALS"
  | "SELF_APPROVAL_BLOCKED"
  | "NOT_ASSIGNEE"
  | "REASON_REQUIRED";

export function checkApprovalMatrix(steps: readonly MatrixStep[]): { ok: true } | { ok: false; violation: WorkflowViolation } {
  if (steps.length === 0) return { ok: false, violation: "NO_APPROVAL_MATRIX" };
  for (const s of steps) {
    const distinct = new Set(s.approverIds).size;
    if (distinct === 0) return { ok: false, violation: "STEP_WITHOUT_APPROVER" };
    if (!Number.isInteger(s.requiredApprovals) || s.requiredApprovals < 1 || s.requiredApprovals > distinct) {
      return { ok: false, violation: "INVALID_REQUIRED_APPROVALS" };
    }
  }
  return { ok: true };
}

export interface DecisionContext {
  readonly actorId: string;
  readonly taskAssigneeId: string;
  readonly initiatorId: string;
  /** Kurum politikası: başlatan kendi onayını verebilir mi? Varsayılan: false. */
  readonly allowSelfApproval?: boolean;
}

export type DecisionKind = "APPROVE" | "REJECT" | "RETURN";

export function checkApprovalDecision(
  kind: DecisionKind,
  reason: string | null | undefined,
  ctx: DecisionContext,
): { ok: true } | { ok: false; violation: WorkflowViolation } {
  if (ctx.actorId !== ctx.taskAssigneeId) return { ok: false, violation: "NOT_ASSIGNEE" };
  if (ctx.actorId === ctx.initiatorId && ctx.allowSelfApproval !== true) {
    return { ok: false, violation: "SELF_APPROVAL_BLOCKED" };
  }
  if ((kind === "REJECT" || kind === "RETURN") && (reason ?? "").trim().length === 0) {
    return { ok: false, violation: "REASON_REQUIRED" };
  }
  return { ok: true };
}
