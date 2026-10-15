// Test altyapısı: GERÇEK PostgreSQL 16 (embedded-postgres). Her test dosyası kendi geçici veritabanını açar,
// Prisma migration'larını `prisma migrate deploy` ile uygular. Docker gerektirmez (ADR-0019).
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import { createPrisma, type PrismaClient } from "../client.js";

const DB_ROOT = fileURLToPath(new URL("../../", import.meta.url));

function freePort(): Promise<number> {
  return new Promise((resolveP, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (typeof addr !== "object" || !addr) { reject(new Error("port yok")); return; }
      const p = addr.port;
      srv.close(() => { resolveP(p); });
    });
  });
}

export interface TestDb {
  readonly url: string;
  readonly prisma: PrismaClient;
  stop(): Promise<void>;
}

export async function startTestDb(): Promise<TestDb> {
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), "ekos-pg-"));
  const pg = new EmbeddedPostgres({ databaseDir: dir, user: "ekos", password: "ekos-test-only", port, persistent: false });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("ekos_test");
  const url = `postgresql://ekos:ekos-test-only@127.0.0.1:${String(port)}/ekos_test`;
  execFileSync(join(DB_ROOT, "node_modules/.bin/prisma"), ["migrate", "deploy"], {
    cwd: DB_ROOT,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
  const prisma = createPrisma(url);
  return {
    url,
    prisma,
    async stop() {
      await prisma.$disconnect();
      await pg.stop();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
