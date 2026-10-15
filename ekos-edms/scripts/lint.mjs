// Lint çalıştırıcı. Tüm repo tek eslint sürecinde (projectService ile) bellek sınırını aşıyor; bu yüzden hedefler
// sırayla ayrı süreçlerde çalışır. Kapsam denetimi: depodaki her .ts/.tsx/.mjs dosyası bir hedefte olmalıdır.
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const TARGETS = ["packages/core", "packages/adapters", "packages/db", "apps/web", "apps/worker", "e2e", "scripts"];
const ROOT_FILES = ["eslint.config.mjs", "playwright.config.ts", "vitest.config.ts"];
const IGNORED_DIRS = new Set(["node_modules", ".next", "dist", "coverage", "playwright-report", "test-results", ".git"]);
const SRC = /\.(ts|tsx|mts|mjs)$/;

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (IGNORED_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (SRC.test(name) && !name.endsWith(".d.ts") && name !== "next-env.d.ts") out.push(relative(root, p).split(sep).join("/"));
  }
  return out;
}

// 1) Kapsam denetimi
const covered = (f) => TARGETS.some((t) => f === t || f.startsWith(`${t}/`)) || ROOT_FILES.includes(f);
const allFiles = walk(root, []);
const uncovered = allFiles.filter((f) => !covered(f) && !f.startsWith("packages/db/prisma.config"));
if (uncovered.length > 0) {
  console.error("Lint kapsamı dışında kalan kaynak dosyalar:\n" + uncovered.join("\n"));
  process.exit(2);
}

// 2) Hedefleri sırayla lint'le
let failed = 0;
for (const t of [...TARGETS, ...ROOT_FILES]) {
  const r = spawnSync("npx", ["eslint", t, "--max-warnings=0"], { cwd: root, stdio: "inherit", env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=4096" } });
  const ok = r.status === 0;
  console.log(`${ok ? "OK  " : "FAIL"} ${t}`);
  if (!ok) failed++;
}
process.exit(failed === 0 ? 0 : 1);
