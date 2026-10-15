// Şema sapma kontrolü (GERÇEK PostgreSQL): migrasyonlarla oluşan veritabanı ile prisma/schema arasında fark olmamalı.
//
// Prisma'nın modelleyemediği, bilinçli olarak yalnız SQL migrasyonlarında yönetilen nesneler ayrıca listelenir
// (her biri gerekçesiyle). Bu listenin dışındaki HER fark testi başarısız yapar.
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDb, type TestDb } from "./testing/pg-harness.js";

const DB_ROOT = join(import.meta.dirname, "..");
let db: TestDb;

/** SQL-yönetimli nesneler: Prisma şema dilinde ifade edilemez (üretilmiş tsvector kolonu, GIN/trgm indeksleri). */
const SQL_MANAGED: { pattern: RegExp; reason: string }[] = [
  { pattern: /DROP INDEX "public"\."ekos_document_search_vector_idx"/, reason: "GIN indeksi (tsvector), arama: documents/search.ts" },
  { pattern: /DROP INDEX "public"\."ekos_document_search_trgm_idx"/, reason: "GIN trigram indeksi, arama" },
  { pattern: /ALTER TABLE "public"\."Document" DROP COLUMN "searchVector"/, reason: "üretilmiş tsvector kolonu (GENERATED), migrations.test.ts doğrular" },
];

beforeAll(async () => {
  db = await startTestDb();
}, 120_000);

afterAll(async () => {
  await db.stop();
});

/** Diff çıktısını ifadelere böler ve SQL-yönetimli olanları çıkarır. Kalan ifadeler sapmadır. */
function unexplainedStatements(sql: string): string[] {
  return sql
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"))
    .filter((s) => !SQL_MANAGED.some((m) => m.pattern.test(s)));
}

describe("şema sapması", () => {
  it("migrasyonlar ile schema.prisma arasında, SQL-yönetimli liste dışında fark yok", () => {
    let code = 0;
    let out = "";
    try {
      out = execFileSync(
        join(DB_ROOT, "node_modules/.bin/prisma"),
        ["migrate", "diff", "--from-url", db.url, "--to-schema-datamodel", "prisma/schema", "--script", "--exit-code"],
        { cwd: DB_ROOT, env: { ...process.env, DATABASE_URL: db.url }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (e) {
      const err = e as { status?: number; stdout?: string };
      code = err.status ?? 1;
      out = err.stdout ?? "";
    }
    // 0 = fark yok; 2 = fark var (ayrıntı aşağıda). Diğer kodlar araç hatasıdır.
    expect([0, 2]).toContain(code);
    expect(unexplainedStatements(out)).toEqual([]);
  }, 120_000);

  it("SQL-yönetimli listedeki her nesne gerçekten var (liste eskimiş değil)", async () => {
    const idx = await db.prisma.$queryRaw<{ indexname: string }[]>`SELECT indexname FROM pg_indexes WHERE schemaname='public'`;
    const names = idx.map((r) => r.indexname);
    expect(names).toEqual(expect.arrayContaining(["ekos_document_search_vector_idx", "ekos_document_search_trgm_idx"]));
    const col = await db.prisma.$queryRaw<{ is_generated: string }[]>`SELECT is_generated FROM information_schema.columns WHERE table_name='Document' AND column_name='searchVector'`;
    expect(col[0]?.is_generated).toBe("ALWAYS");
  });
});
