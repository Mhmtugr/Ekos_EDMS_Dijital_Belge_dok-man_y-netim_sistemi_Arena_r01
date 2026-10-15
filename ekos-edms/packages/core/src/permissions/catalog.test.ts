// Doküman-kod tutarlılığı: docs/PERMISSIONS.md §5 matrisi ile ROLE_TEMPLATES birebir aynı olmalı.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PERMISSION_CODES } from "./codes.js";
import { ROLE_TEMPLATES, findRoleTemplate } from "./catalog.js";

const here = dirname(fileURLToPath(import.meta.url));
const docPath = join(here, "..", "..", "..", "..", "docs", "PERMISSIONS.md");

function parseMatrix(): { columns: string[]; rows: Map<string, string[]> } {
  const lines = readFileSync(docPath, "utf8").split("\n");
  const start = lines.findIndex((l) => l.startsWith("| İzin kodu"));
  if (start < 0) throw new Error("matris bulunamadı");
  const columns = (lines[start] ?? "")
    .split("|")
    .slice(2, -1)
    .map((c) => c.trim());
  const rows = new Map<string, string[]>();
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith("|")) break;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    rows.set(cells[0] ?? "", cells.slice(1));
  }
  return { columns, rows };
}

describe("rol kataloğu ↔ PERMISSIONS.md", () => {
  const { columns, rows } = parseMatrix();

  it("matristeki her izin kodu kataloğun izin listesiyle aynı", () => {
    expect([...rows.keys()].sort()).toEqual([...PERMISSION_CODES].sort());
  });

  it("her rol şablonu matris sütunuyla birebir eşleşir (✔/K → izin, K → kapsam zorunlu)", () => {
    for (const template of ROLE_TEMPLATES) {
      const col = columns.indexOf(template.matrixColumn);
      expect(col, `sütun ${template.matrixColumn}`).toBeGreaterThanOrEqual(0);
      const expected: string[] = [];
      const expectedScoped: string[] = [];
      for (const [code, cells] of rows) {
        const v = cells[col];
        if (v === "✔" || v === "K") expected.push(code);
        if (v === "K") expectedScoped.push(code);
      }
      expect([...template.permissions].sort(), template.code).toEqual(expected.sort());
      expect([...template.scopedPermissions].sort(), `${template.code} scoped`).toEqual(expectedScoped.sort());
    }
  });

  it("10 rol şablonu var ve kodları benzersiz", () => {
    expect(ROLE_TEMPLATES).toHaveLength(10);
    expect(new Set(ROLE_TEMPLATES.map((t) => t.code)).size).toBe(10);
  });

  it("findRoleTemplate bilinmeyen rol için undefined döner", () => {
    expect(findRoleTemplate("NOPE")).toBeUndefined();
    expect(findRoleTemplate("PLATFORM_ADMIN")?.name).toBe("Platform Yöneticisi");
  });
});

describe("kurallar (PERMISSIONS.md §4)", () => {
  it("Platform Yöneticisi hiçbir belge/sözleşme izni taşımaz", () => {
    const py = findRoleTemplate("PLATFORM_ADMIN");
    expect(
      py?.permissions.filter((p) => p.startsWith("document.") || p.startsWith("contract.")),
    ).toEqual([]);
    expect([...(py?.permissions ?? [])].sort()).toEqual([
      "config.manage",
      "integration.manage",
      "role.manage",
      "system.health",
      "user.manage",
    ]);
  });

  it("Güvenlik Denetçisi belge içeriği izni taşımaz", () => {
    const gd = findRoleTemplate("SECURITY_AUDITOR");
    const forbidden = [
      "document.list",
      "document.view_metadata",
      "document.preview",
      "document.download",
      "document.export",
    ];
    for (const p of forbidden) expect(gd?.permissions).not.toContain(p);
    expect([...(gd?.permissions ?? [])].sort()).toEqual([
      "audit.export",
      "audit.view",
      "breakglass.approve",
      "system.health",
    ]);
  });

  it("Kayıt/Arşiv Yöneticisi imha onayı (Y) şablonda yoktur: kurum politikasıyla ayrıca verilir", () => {
    expect(findRoleTemplate("RECORDS_MANAGER")?.permissions).not.toContain("document.disposal_approve");
  });

  it("Hukuk izinleri (legal_hold, legal_review) yalnızca hukuk rolündedir", () => {
    const withLegal = ROLE_TEMPLATES.filter((t) =>
      t.permissions.some((p) => p === "document.legal_hold" || p === "contract.legal_review"),
    ).map((t) => t.code);
    expect(withLegal).toEqual(["LEGAL_REVIEWER"]);
  });
});
