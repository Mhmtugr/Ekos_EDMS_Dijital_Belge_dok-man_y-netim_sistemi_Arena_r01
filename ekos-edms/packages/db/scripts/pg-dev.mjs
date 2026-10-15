// Geliştirme/test için gerçek PostgreSQL 16 (embedded-postgres). Docker olmayan ortamlar içindir.
// Kullanım: node scripts/pg-dev.mjs [port]   — veri dizini: .pgdata (geçici, git'e girmez)
import EmbeddedPostgres from "embedded-postgres";
import { existsSync, rmSync } from "node:fs";

const port = Number(process.argv[2] ?? 54330);
const dir = new URL("../.pgdata", import.meta.url).pathname;
if (!existsSync(`${dir}/PG_VERSION`)) {
  rmSync(dir, { recursive: true, force: true });
}
const pg = new EmbeddedPostgres({ databaseDir: dir, user: "ekos", password: "ekos-dev-only", port, persistent: true });
if (!existsSync(`${dir}/PG_VERSION`)) await pg.initialise();
await pg.start();
try {
  await pg.createDatabase("ekos_dev");
} catch {
  // Veritabanı zaten var.
}
console.log(`PostgreSQL hazır: postgresql://ekos:ekos-dev-only@127.0.0.1:${port}/ekos_dev`);
process.on("SIGTERM", async () => {
  await pg.stop();
  process.exit(0);
});
await new Promise(() => {});
