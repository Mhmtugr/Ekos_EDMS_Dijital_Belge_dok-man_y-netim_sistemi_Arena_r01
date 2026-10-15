// Yedek CLI (Faz 7). Kullanım:
//   DATABASE_URL=... npx tsx scripts/backup.ts export <dizin>   # yedek al
//   DATABASE_URL=... npx tsx scripts/backup.ts verify <dizin>   # dosya bütünlüğünü denetle (DB gerekmez)
//   DATABASE_URL=... npx tsx scripts/backup.ts import <dizin>   # BOŞ hedefe geri yükle
import { createPrisma, exportDatabase, importDatabase, verifyBackupFiles } from "../src/index.js";

async function main(): Promise<void> {
  const [cmd, dir] = process.argv.slice(2);
  if (!cmd || !dir || !["export", "verify", "import"].includes(cmd)) {
    throw new Error("Kullanım: backup.ts <export|verify|import> <dizin>");
  }
  if (cmd === "verify") {
    const problems = verifyBackupFiles(dir);
    if (problems.length > 0) throw new Error(`Yedek bütünlüğü bozuk: ${problems.join("; ")}`);
    process.stdout.write("Yedek bütünlüğü tamam\n");
    return;
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL tanımlı değil");
  const prisma = createPrisma(url);
  try {
    if (cmd === "export") {
      const m = await exportDatabase(prisma, dir);
      process.stdout.write(`Yedek alındı: ${String(m.tables.length)} tablo, ${String(m.tables.reduce((a, t) => a + t.rowCount, 0))} satır\n`);
    } else {
      const r = await importDatabase(prisma, dir);
      process.stdout.write(`Geri yükleme tamam: ${String(r.tables)} tablo, ${String(r.rows)} satır (doğrulandı)\n`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.message : "bilinmeyen hata"}\n`);
  process.exitCode = 1;
});
