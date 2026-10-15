// Sözleşme yaşam döngüsü kuralları (Faz 3). Saf fonksiyonlar; veritabanı bağımsız.
// R-LC-02: geçiş tablosu dışındaki her geçiş reddedilir.
// R-LC-03: tüm onaylar tamamlanmadan READY_FOR_SIGNATURE yoktur.
// R-LC-04: imza kanıtı olmadan ACTIVE yoktur.
// R-LC-06: IMPORTED_HISTORICAL kaynağı onay gibi gösterilmez; onay akışına girmez.
import type { ContractLifecycleStatus } from "../states/index.js";

export const CONTRACT_TRANSITIONS: Readonly<Record<ContractLifecycleStatus, readonly ContractLifecycleStatus[]>> = {
  DRAFT: ["IN_REVIEW", "CANCELLED"],
  IN_REVIEW: ["PENDING_APPROVAL", "DRAFT", "CANCELLED"],
  PENDING_APPROVAL: ["READY_FOR_SIGNATURE", "IN_REVIEW", "CANCELLED"],
  READY_FOR_SIGNATURE: ["PENDING_SIGNATURE", "CANCELLED"],
  PENDING_SIGNATURE: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["AMENDMENT_PENDING", "RENEWAL_REVIEW", "EXPIRED", "TERMINATED"],
  AMENDMENT_PENDING: ["ACTIVE", "TERMINATED"],
  RENEWAL_REVIEW: ["ACTIVE", "EXPIRED", "TERMINATED"],
  EXPIRED: ["ARCHIVED"],
  TERMINATED: ["ARCHIVED"],
  CANCELLED: ["ARCHIVED"],
  ARCHIVED: ["DISPOSAL_REVIEW"],
  DISPOSAL_REVIEW: ["DISPOSED"],
  DISPOSED: [],
  // INVALID her durumdan yalnızca yetkili ve gerekçeli geçilir (servis katmanı); buradan yalnızca ARCHIVED'a çıkılır.
  INVALID: ["ARCHIVED"],
};

/** Yetkili ve gerekçeli olarak her durumdan INVALID'e geçiş (servis katmanı yetkisini denetler). */
export const INVALID_TARGET: ContractLifecycleStatus = "INVALID";

export interface ContractTransitionContext {
  readonly origin: "MANUAL" | "IMPORTED_HISTORICAL";
  /** Bu sözleşmeye bağlı tüm onay örnekleri tamamlanmış ve hepsi APPROVED mı? (en az bir örnek olmalı) */
  readonly allApprovalsCompleted: boolean;
  /** Geçerli, imzalı sürüm ve imza kanıtı kaydı var mı? */
  readonly hasSignatureEvidence: boolean;
  /** Yetkili ve gerekçeli INVALID geçişi mi? */
  readonly invalidWithAuthorityAndReason?: boolean;
}

export type ContractTransitionViolation =
  | "TRANSITION_NOT_ALLOWED"
  | "APPROVALS_INCOMPLETE"
  | "SIGNATURE_EVIDENCE_MISSING"
  | "HISTORICAL_NOT_APPROVABLE"
  | "INVALID_REQUIRES_AUTHORITY_AND_REASON";

export function checkContractTransition(
  from: ContractLifecycleStatus,
  to: ContractLifecycleStatus,
  ctx: ContractTransitionContext,
): { ok: true } | { ok: false; violation: ContractTransitionViolation } {
  if (to === INVALID_TARGET) {
    return ctx.invalidWithAuthorityAndReason === true
      ? { ok: true }
      : { ok: false, violation: "INVALID_REQUIRES_AUTHORITY_AND_REASON" };
  }
  if (!CONTRACT_TRANSITIONS[from].includes(to)) return { ok: false, violation: "TRANSITION_NOT_ALLOWED" };

  // R-LC-06: geçmiş kayıt onay akışına (READY/SIGNATURE/ACTIVE) girmez.
  if (ctx.origin === "IMPORTED_HISTORICAL" && (to === "READY_FOR_SIGNATURE" || to === "PENDING_SIGNATURE" || to === "ACTIVE")) {
    return { ok: false, violation: "HISTORICAL_NOT_APPROVABLE" };
  }
  // R-LC-03
  if (to === "READY_FOR_SIGNATURE" && !ctx.allApprovalsCompleted) {
    return { ok: false, violation: "APPROVALS_INCOMPLETE" };
  }
  // R-LC-04 (AMENDMENT_PENDING/RENEWAL_REVIEW'den ACTIVE'e de imza kanıtı gerekir)
  if (to === "ACTIVE" && !ctx.hasSignatureEvidence) {
    return { ok: false, violation: "SIGNATURE_EVIDENCE_MISSING" };
  }
  return { ok: true };
}
