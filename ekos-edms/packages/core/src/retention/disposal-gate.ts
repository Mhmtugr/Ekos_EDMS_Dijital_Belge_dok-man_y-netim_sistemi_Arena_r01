// Otomatik imha kapısı (Faz 4'e hazırlık, R-RET-02, R-RET-03, R-RET-01). Bu sürümde OTOMATİK İMHA KAPALIDIR.
// Kapı her zaman kapalı döner; açılması Faz 4'te, doğrulanmış profil + hukuki bekletme yokken ve ikinci onay ile olur.
export type AutoDisposalBlock =
  | "AUTO_DISPOSAL_DISABLED"
  | "NO_RETENTION_PROFILE"
  | "PROFILE_NOT_VERIFIED"
  | "PROFILE_START_EVENT_MISSING"
  | "LEGAL_HOLD_ACTIVE";

export interface DisposalGateInput {
  readonly profile: { readonly verifiedByLegal: boolean; readonly startEvent: string | null; readonly durationValue: number | null } | null;
  readonly legalHoldActive: boolean;
}

/** Hiçbir girdi otomatik imhaya izin vermez (bu sürüm). Tüm nedenler döner, denetim için. */
export function evaluateAutoDisposal(input: DisposalGateInput): { allowed: false; blocks: AutoDisposalBlock[] } {
  const blocks: AutoDisposalBlock[] = ["AUTO_DISPOSAL_DISABLED"];
  if (!input.profile) blocks.push("NO_RETENTION_PROFILE");
  else {
    if (!input.profile.verifiedByLegal) blocks.push("PROFILE_NOT_VERIFIED");
    if (!input.profile.startEvent || input.profile.durationValue === null) blocks.push("PROFILE_START_EVENT_MISSING");
  }
  if (input.legalHoldActive) blocks.push("LEGAL_HOLD_ACTIVE");
  return { allowed: false, blocks };
}
