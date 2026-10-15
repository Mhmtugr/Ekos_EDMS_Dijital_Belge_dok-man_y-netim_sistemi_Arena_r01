// Faz 7 R-SEC-02: .env.example ile kodun okuduğu ortam değişkenleri birebir uyumlu olmalı.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const SCAN_DIRS = ["apps/web/app", "apps/web/lib", "apps/web/scripts", "apps/web/instrumentation.ts", "apps/worker/src", "packages/adapters/src", "packages/db/src", "packages/db/scripts", "packages/core/src"];
// Yapılandırma doğrulayıcısının kural tablosundaki limit anahtarları (kod içinde doğrudan process.env okunmaz).
const LIMIT_KEYS = ["MAX_UPLOAD_MB", "MAX_MANIFEST_MB", "SEARCH_PAGE_MAX", "JOBS_INTERVAL_SECONDS", "ESIGN_TIMEOUT_MS", "CLAMD_TIMEOUT_MS"];
// Çalışma zamanı tarafından sağlanan / kodla ilgisiz anahtarlar.
const RUNTIME_KEYS = new Set(["NEXT_RUNTIME"]);

function walk(p: string, out: string[]): string[] {
  const st = statSync(p);
  if (st.isFile()) {
    if (/\.(ts|tsx|mjs)$/.test(p) && !/\.test\.ts$/.test(p)) out.push(p);
    return out;
  }
  for (const n of readdirSync(p)) {
    if (n === "node_modules" || n === ".next") continue;
    walk(join(p, n), out);
  }
  return out;
}

describe(".env.example ↔ kod uyumu", () => {
  it("kodun okuduğu her ortam değişkeni .env.example içinde tanımlı", () => {
    const files = SCAN_DIRS.flatMap((d) => walk(join(root, d), []));
    const used = new Set<string>(LIMIT_KEYS);
    const re = /process\.env(?:\.([A-Z][A-Z0-9_]*)|\["([A-Z][A-Z0-9_]*)"\])|readEnv\([^,]+,\s*"([A-Z][A-Z0-9_]*)"/g;
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(re)) {
        const key = m[1] ?? m[2] ?? m[3];
        if (key && !RUNTIME_KEYS.has(key)) used.add(key);
      }
    }
    const example = readFileSync(join(root, ".env.example"), "utf8");
    const declared = new Set([...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1] ?? ""));
    const missing = [...used].filter((k) => !declared.has(k)).sort();
    expect(missing).toEqual([]);
  });

  it("şablon gerçek değer içermez (tüm değerler boş ya da güvenli varsayılan)", () => {
    const example = readFileSync(join(root, ".env.example"), "utf8");
    const lines = example.split("\n").filter((l) => /^[A-Z][A-Z0-9_]*=/.test(l));
    for (const l of lines) {
      const [k, ...rest] = l.split("=");
      const v = rest.join("=");
      if (v === "") continue;
      expect(["NODE_ENV", "CLAMD_PORT", "CLAMD_TIMEOUT_MS", "ESIGN_TIMEOUT_MS", "JOBS_INTERVAL_SECONDS", "WORKER_POLL_MS", "MAX_UPLOAD_MB", "MAX_MANIFEST_MB", "SEARCH_PAGE_MAX", "AI_DATA_PROCESSING_APPROVED"]).toContain(k);
    }
  });
});
