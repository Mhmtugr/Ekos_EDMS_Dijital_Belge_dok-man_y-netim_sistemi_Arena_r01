// Faz 7 madde 3: yedek → geri yükleme → doğrulama (GERÇEK PostgreSQL, iki ayrı geçici veritabanı).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDb, type TestDb } from "../testing/pg-harness.js";
import { digestDatabase, exportDatabase, importDatabase, readManifest, verifyBackupFiles } from "./backup.js";

const NOW = new Date("2026-10-14T06:00:00Z");
let source: TestDb;
let target: TestDb;
let dir: string;

beforeAll(async () => {
  source = await startTestDb();
  target = await startTestDb();
  dir = mkdtempSync(join(tmpdir(), "ekos-backup-"));
  const p = source.prisma;
  await p.user.create({ data: { email: "yedek-a@t.test", displayName: "Yedek A", updatedAt: NOW } });
  await p.user.create({ data: { email: "yedek-b@t.test", displayName: "Yedek B Ğüşİ", updatedAt: NOW } });
  await p.counterparty.create({ data: { officialName: "Örnek Tedarikçi Ltd. Şti.", countryCode: "TR", status: "ACTIVE", updatedAt: NOW } as never });
  // Üretilen (GENERATED) sütun regresyonu: geri yükleme bu sütuna değer yazmamalı (Document.searchVector ile aynı sınıf).
  for (const db of [p, target.prisma]) {
    await db.$executeRawUnsafe(`CREATE TABLE "zz_backup_gen" (id integer PRIMARY KEY, a text NOT NULL, b text GENERATED ALWAYS AS (upper(a)) STORED)`);
  }
  await p.$executeRawUnsafe(`INSERT INTO "zz_backup_gen" (id, a) VALUES (1, 'merhaba')`);
});

afterAll(async () => {
  await source.stop();
  await target.stop();
  rmSync(dir, { recursive: true, force: true });
});

describe("mantıksal yedek ve geri yükleme", () => {
  it("dışa aktarma manifest ve tablo dosyaları üretir; bütünlük denetimi temiz", async () => {
    const m = await exportDatabase(source.prisma, dir, NOW);
    expect(m.format).toBe("ekos-logical-backup/1");
    expect(m.lastMigration).not.toBeNull();
    const users = m.tables.find((t) => t.name === "User");
    expect(users?.rowCount).toBe(2);
    expect(verifyBackupFiles(dir)).toEqual([]);
  });

  it("geri yükleme boş hedefe yapılır; her tablonun özeti kaynakla birebir aynıdır", async () => {
    const r = await importDatabase(target.prisma, dir);
    expect(r.tables).toBeGreaterThan(10);
    expect(r.rows).toBeGreaterThanOrEqual(3);
    const a = await digestDatabase(source.prisma);
    const b = await digestDatabase(target.prisma);
    const byName = (xs: { name: string; sha256: string; rowCount: number }[]) => Object.fromEntries(xs.map((x) => [x.name, `${String(x.rowCount)}:${x.sha256}`]));
    expect(byName(b.tables)).toEqual(byName(a.tables));
    const gen = await target.prisma.$queryRawUnsafe<{ b: string }[]>(`SELECT b FROM "zz_backup_gen" WHERE id = 1`);
    expect(gen).toEqual([{ b: "MERHABA" }]); // üretilen sütun hedefte yeniden hesaplandı
    const restored = await target.prisma.user.findUniqueOrThrow({ where: { email: "yedek-b@t.test" } });
    expect(restored.displayName).toBe("Yedek B Ğüşİ");
  });

  it("boş olmayan hedefe geri yükleme reddedilir (üzerine yazma yok)", async () => {
    await expect(importDatabase(source.prisma, dir)).rejects.toThrow(/boş değil/);
  });

  it("bozulmuş yedek dosyası tespit edilir ve geri yüklemeyi durdurur", async () => {
    const bad = mkdtempSync(join(tmpdir(), "ekos-backup-bad-"));
    try {
      await exportDatabase(source.prisma, bad, NOW);
      const file = join(bad, "tables", "User.ndjson");
      writeFileSync(file, readFileSync(file, "utf8").replace("yedek-a@t.test", "saldiri@t.test"), "utf8");
      expect(verifyBackupFiles(bad).some((p) => p.startsWith("User"))).toBe(true);
      const fresh = await startTestDb();
      try {
        await expect(importDatabase(fresh.prisma, bad)).rejects.toThrow(/bütünlüğü bozuk/);
        expect(await fresh.prisma.user.count()).toBe(0);
      } finally {
        await fresh.stop();
      }
    } finally {
      rmSync(bad, { recursive: true, force: true });
    }
  });

  it("farklı migration sürümüne geri yükleme reddedilir", async () => {
    const other = mkdtempSync(join(tmpdir(), "ekos-backup-mig-"));
    try {
      await exportDatabase(source.prisma, other, NOW);
      const m = readManifest(other);
      writeFileSync(join(other, "manifest.json"), JSON.stringify({ ...m, lastMigration: "0001_olmayan" }), "utf8");
      const fresh = await startTestDb();
      try {
        await expect(importDatabase(fresh.prisma, other)).rejects.toThrow(/Migration sürümü uyuşmuyor/);
      } finally {
        await fresh.stop();
      }
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});
