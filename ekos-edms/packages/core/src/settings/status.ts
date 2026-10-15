// Yapılandırma durumu (Faz 1 madde 6): completed | unverified | required | optional | failed
export type SettingState = "completed" | "unverified" | "required" | "optional" | "failed";

export interface SettingFacts {
  readonly required: boolean;
  readonly configured: boolean;
  /** Canlı doğrulama denendi mi ve sonuç ne? null = denenmedi. */
  readonly verification: "PASSED" | "FAILED" | null;
}

export function evaluateSettingState(f: SettingFacts): SettingState {
  if (!f.configured) return f.required ? "required" : "optional";
  if (f.verification === "FAILED") return "failed";
  if (f.verification === "PASSED") return "completed";
  return "unverified";
}
