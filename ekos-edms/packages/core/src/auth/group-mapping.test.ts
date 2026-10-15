import { describe, expect, it } from "vitest";
import { resolveRoleCodes } from "./group-mapping.js";

const mappings = [
  { externalGroupId: "g-hr", roleCode: "DEPARTMENT_USER" },
  { externalGroupId: "g-legal", roleCode: "LEGAL_REVIEWER" },
  { externalGroupId: "g-legal", roleCode: "CONTRACT_MANAGER" },
];

describe("resolveRoleCodes", () => {
  it("eşleşen grupların rollerini döner (tekilleştirilmiş, sıralı)", () => {
    expect(resolveRoleCodes(["g-legal", "g-unknown"], mappings)).toEqual([
      "CONTRACT_MANAGER",
      "LEGAL_REVIEWER",
    ]);
  });
  it("eşleşme yoksa boş liste (varsayılan red)", () => {
    expect(resolveRoleCodes(["g-x"], mappings)).toEqual([]);
  });
  it("grup listesi boşsa rol yok", () => {
    expect(resolveRoleCodes([], mappings)).toEqual([]);
  });
});
