// Mantıksal yedek ve geri yükleme (Faz 7, madde 3). pg_dump bu ortamda yoktur; yedek, her tablonun satırlarının
// NDJSON dökümü + SHA-256 manifesti olarak yazılır. Geri yükleme yalnız BOŞ bir veritabanına ve aynı son migration'a
// yapılır; geri yüklenen veri, manifestle satır sayısı ve özet bakımından yeniden karşılaştırılır.
// Notlar:
// - Geri yükleme oturumunda session_replication_role = replica kullanılır (FK/trigger sırasını bypass eder); bu yetkili
//   bir veritabanı rolü gerektirir.
// - Dosya nesneleri (STORAGE_ROOT) bu yedeğin KAPSAMINDA DEĞİLDİR: ayrı dosya yedeği alınmalıdır (docs/OPERASYON.md).
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Prisma, PrismaClient } from "@prisma/client";

export const BACKUP_FORMAT = "ekos-logical-backup/1";
const EXCLUDED_TABLES = new Set(["_prisma_migrations"]);

export interface TableDigest {
  readonly name: string;
  readonly rowCount: number;
  readonly sha256: string;
  readonly ndjson: string;
}

export interface BackupManifest {
  readonly format: typeof BACKUP_FORMAT;
  readonly createdAt: string;
  readonly lastMigration: string | null;
  readonly tables: readonly { readonly name: string; readonly rowCount: number; readonly sha256: string }[];
}

/** Yazılabilir sütunlar: üretilmeyen (is_generated = 'NEVER') sütunlar, tablo sırasıyla. */
async function insertableColumns(tx: Prisma.TransactionClient, table: string): Promise<string[]> {
  const rows = await tx.$queryRawUnsafe<{ column_name: string }[]>(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND is_generated = 'NEVER' ORDER BY ordinal_position",
    table,
  );
  if (rows.length === 0) throw new Error(`Tablo sütunları okunamadı: ${table}`);
  return rows.map((r) => r.column_name);
}

function quoteIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error("Geçersiz tablo adı");
  return `"${name}"`;
}

async function publicTables(prisma: PrismaClient): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  );
  return rows.map((r) => r.tablename).filter((t) => !EXCLUDED_TABLES.has(t));
}

async function lastMigration(prisma: PrismaClient): Promise<string | null> {
  const rows = await prisma
    .$queryRawUnsafe<{ migration_name: string }[]>(
      "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at DESC, migration_name DESC LIMIT 1",
    )
    .catch(() => []);
  return rows[0]?.migration_name ?? null;
}

/** Tüm kullanıcı tablolarının kararlı NDJSON dökümü ve özetleri (bellekte; dosya yazmaz). */
export async function digestDatabase(prisma: PrismaClient): Promise<{ tables: TableDigest[]; lastMigration: string | null }> {
  const tables: TableDigest[] = [];
  for (const name of await publicTables(prisma)) {
    const rows = await prisma.$queryRawUnsafe<{ j: string }[]>(
      `SELECT j FROM (SELECT row_to_json(x)::text AS j FROM ${quoteIdent(name)} x) s ORDER BY j`,
    );
    const lines = rows.map((r) => r.j);
    const ndjson = lines.length > 0 ? `${lines.join("\n")}\n` : "";
    tables.push({ name, rowCount: lines.length, sha256: createHash("sha256").update(ndjson).digest("hex"), ndjson });
  }
  return { tables, lastMigration: await lastMigration(prisma) };
}

export async function exportDatabase(prisma: PrismaClient, dir: string, now: Date = new Date()): Promise<BackupManifest> {
  const { tables, lastMigration: mig } = await digestDatabase(prisma);
  mkdirSync(join(dir, "tables"), { recursive: true });
  for (const t of tables) writeFileSync(join(dir, "tables", `${t.name}.ndjson`), t.ndjson, "utf8");
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    createdAt: now.toISOString(),
    lastMigration: mig,
    tables: tables.map(({ name, rowCount, sha256 }) => ({ name, rowCount, sha256 })),
  };
  writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

export function readManifest(dir: string): BackupManifest {
  const raw: unknown = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  if (typeof raw !== "object" || raw === null || (raw as { format?: unknown }).format !== BACKUP_FORMAT) {
    throw new Error("Bilinmeyen yedek biçimi");
  }
  return raw as BackupManifest;
}

/** Yedek dosyalarını manifestle karşılaştırır. Boş dizi = bütünlük tamam. */
export function verifyBackupFiles(dir: string): string[] {
  const m = readManifest(dir);
  const problems: string[] = [];
  const onDisk = new Set(existsSync(join(dir, "tables")) ? readdirSync(join(dir, "tables")).map((f) => f.replace(/\.ndjson$/, "")) : []);
  for (const t of m.tables) {
    if (!onDisk.has(t.name)) {
      problems.push(`${t.name}: dosya yok`);
      continue;
    }
    const text = readFileSync(join(dir, "tables", `${t.name}.ndjson`), "utf8");
    if (createHash("sha256").update(text).digest("hex") !== t.sha256) problems.push(`${t.name}: özet uyuşmuyor`);
    const count = text.split("\n").filter((l) => l.length > 0).length;
    if (count !== t.rowCount) problems.push(`${t.name}: satır sayısı uyuşmuyor`);
  }
  return problems;
}

/**
 * Geri yükleme: yalnız boş veritabanına ve aynı son migration'a yapılır. Yazım tek transaction içindedir; sonrasında
 * veritabanı yeniden dökülür ve manifestle (satır sayısı + özet) karşılaştırılır. Uyuşmazlıkta transaction geri alınır.
 */
export async function importDatabase(prisma: PrismaClient, dir: string): Promise<{ tables: number; rows: number }> {
  const problems = verifyBackupFiles(dir);
  if (problems.length > 0) throw new Error(`Yedek bütünlüğü bozuk: ${problems.join("; ")}`);
  const m = readManifest(dir);
  const target = await lastMigration(prisma);
  if (target !== m.lastMigration) throw new Error(`Migration sürümü uyuşmuyor (yedek: ${m.lastMigration ?? "yok"}, hedef: ${target ?? "yok"})`);
  for (const t of await publicTables(prisma)) {
    const r = await prisma.$queryRawUnsafe<{ c: bigint }[]>(`SELECT count(*)::bigint AS c FROM ${quoteIdent(t)}`);
    if (Number(r[0]?.c ?? 0) > 0) throw new Error(`Hedef veritabanı boş değil (${t}); geri yükleme yalnız boş veritabanına yapılır`);
  }

  let rows = 0;
  const written = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
    for (const t of m.tables) {
      const text = readFileSync(join(dir, "tables", `${t.name}.ndjson`), "utf8");
      if (text.length === 0) continue;
      const payload = `[${text.trimEnd().split("\n").join(",")}]`;
      // Üretilen (GENERATED) sütunlar (ör. searchVector tsvector) yazılamaz; PostgreSQL bunları yeniden hesaplar.
      const cols = await insertableColumns(tx, t.name);
      const list = cols.map(quoteIdent).join(", ");
      await tx.$executeRawUnsafe(
        `INSERT INTO ${quoteIdent(t.name)} (${list}) SELECT ${list} FROM json_populate_recordset(NULL::${quoteIdent(t.name)}, $1::json)`,
        payload,
      );
      rows += t.rowCount;
    }
    // Doğrulama transaction içinde yapılır: uyuşmazlıkta yazım geri alınır (yarım geri yükleme kalmaz).
    const after = await digestInTx(tx);
    return after;
  });

  const mismatches = m.tables.filter((t) => {
    const c = written.find((x) => x.name === t.name);
    return !c || c.rowCount !== t.rowCount || c.sha256 !== t.sha256;
  });
  if (mismatches.length > 0) {
    throw new Error(`Geri yükleme doğrulaması başarısız: ${mismatches.map((x) => x.name).join(", ")}`);
  }
  return { tables: m.tables.length, rows };
}

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

async function digestInTx(tx: Tx): Promise<{ name: string; rowCount: number; sha256: string }[]> {
  const names = await tx.$queryRawUnsafe<{ tablename: string }[]>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  );
  const out: { name: string; rowCount: number; sha256: string }[] = [];
  for (const { tablename } of names) {
    if (EXCLUDED_TABLES.has(tablename)) continue;
    const rows = await tx.$queryRawUnsafe<{ j: string }[]>(
      `SELECT j FROM (SELECT row_to_json(x)::text AS j FROM ${quoteIdent(tablename)} x) s ORDER BY j`,
    );
    const lines = rows.map((r) => r.j);
    const ndjson = lines.length > 0 ? `${lines.join("\n")}\n` : "";
    out.push({ name: tablename, rowCount: lines.length, sha256: createHash("sha256").update(ndjson).digest("hex") });
  }
  return out;
}
