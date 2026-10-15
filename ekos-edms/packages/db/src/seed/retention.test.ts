// Saklama profili dosyası doğrulaması: politika eksikken profil "bekliyor" olarak yüklenebilir;
// hukuk onaylı profil eksik alan taşıyamaz (uydurma değer ve sessiz düzeltme yok).
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadRetentionFile } from "./catalog-seed.js";

function withFile(profiles: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), "ret-"));
  const path = join(dir, "retention.json");
  writeFileSync(path, JSON.stringify({ profiles }));
  return path;
}

const pending = { code: "RP-X", name: "X", startEvent: null, durationValue: null, durationUnit: null, disposalMethod: null, verifiedByLegal: false, basisNote: null };

describe("loadRetentionFile", () => {
  it("politika bekleyen profili kabul eder (değerler null kalır)", () => {
    const [p] = loadRetentionFile(withFile([pending]));
    expect(p?.verifiedByLegal).toBe(false);
    expect(p?.durationValue).toBeNull();
    expect(p?.startEvent).toBeNull();
  });

  it("hukuk onaylı profilde başlangıç olayı ve imha yöntemi zorunludur", () => {
    expect(() => loadRetentionFile(withFile([{ ...pending, verifiedByLegal: true }]))).toThrow(/zorunludur/);
  });

  it("süre değeri ile birimi birlikte girilmelidir", () => {
    expect(() => loadRetentionFile(withFile([{ ...pending, durationValue: 10 }]))).toThrow(/birlikte/);
  });

  it("geçersiz enum ve tekrar eden kod reddedilir", () => {
    expect(() => loadRetentionFile(withFile([{ ...pending, startEvent: "BILINMEYEN" }]))).toThrow(/geçersiz/);
    expect(() => loadRetentionFile(withFile([pending, pending]))).toThrow(/tekrar/);
  });

  it("tam ve onaylı profil kabul edilir", () => {
    const ok = { ...pending, startEvent: "CONTRACT_END", durationValue: 10, durationUnit: "CALENDAR_YEARS", disposalMethod: "DIGITAL_DELETE", verifiedByLegal: true };
    expect(loadRetentionFile(withFile([ok]))[0]?.verifiedByLegal).toBe(true);
  });
});
