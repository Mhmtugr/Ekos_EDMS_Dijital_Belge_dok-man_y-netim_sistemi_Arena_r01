import { describe, expect, it } from "vitest";
import { PERMISSION_CODES, isPermissionCode } from "./codes.js";

describe("izin kodu kataloğu", () => {
  it("A4'te tanımlı 29 izin kodunu içerir", () => {
    expect(PERMISSION_CODES).toHaveLength(29);
  });

  it("kodlar tekildir", () => {
    expect(new Set(PERMISSION_CODES).size).toBe(PERMISSION_CODES.length);
  });

  it("her kod 'alan.eylem' biçimindedir", () => {
    for (const code of PERMISSION_CODES) {
      expect(code).toMatch(/^[a-z_]+\.[a-z_]+$/);
    }
  });

  it("bilinmeyen kod reddedilir (deny-by-default girdisi)", () => {
    expect(isPermissionCode("document.delete_everything")).toBe(false);
    expect(isPermissionCode("")).toBe(false);
    expect(isPermissionCode("document.download")).toBe(true);
  });
});
