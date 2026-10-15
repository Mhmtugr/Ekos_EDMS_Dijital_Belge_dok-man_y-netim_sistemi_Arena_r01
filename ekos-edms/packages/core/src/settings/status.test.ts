import { describe, expect, it } from "vitest";
import { evaluateSettingState } from "./status.js";

describe("evaluateSettingState", () => {
  it("yapılandırılmamış zorunlu ayar: required", () => {
    expect(evaluateSettingState({ required: true, configured: false, verification: null })).toBe("required");
  });
  it("yapılandırılmamış isteğe bağlı ayar: optional", () => {
    expect(evaluateSettingState({ required: false, configured: false, verification: null })).toBe("optional");
  });
  it("yapılandırılmış ama doğrulanmamış: unverified (Bağlı GÖRÜNMEZ)", () => {
    expect(evaluateSettingState({ required: true, configured: true, verification: null })).toBe("unverified");
  });
  it("doğrulama başarısız: failed", () => {
    expect(evaluateSettingState({ required: true, configured: true, verification: "FAILED" })).toBe("failed");
  });
  it("doğrulandı: completed", () => {
    expect(evaluateSettingState({ required: true, configured: true, verification: "PASSED" })).toBe("completed");
  });
});
