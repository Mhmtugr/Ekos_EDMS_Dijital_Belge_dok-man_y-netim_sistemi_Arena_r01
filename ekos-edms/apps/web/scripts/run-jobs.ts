// Zamanlanmış iş çalıştırıcı: hatırlatma döngüsü + bildirim teslimi. Her turda yalnızca bir kez (--once) ya da aralıklı çalışır.
// Gerekli: DATABASE_URL, JOBS_ACTOR_EMAIL (config.manage yetkili kullanıcı; denetim kaydında bu kişi görünür).
// Aralık: JOBS_INTERVAL_SECONDS (varsayılan 300, en az 30). Yapılandırılmamış kanal teslimi NOT_CONFIGURED olarak kaydedilir.
import { createPrisma, loadActorContext } from "@ekos/db";
import { uuidv7, validateRuntimeConfig } from "@ekos/core";
import { runAllJobs } from "../lib/server/jobs";

const once = process.argv.includes("--once");
const url = process.env.DATABASE_URL;
const emailEnv = process.env.JOBS_ACTOR_EMAIL;
if (!url) throw new Error("DATABASE_URL tanımlı değil");
if (!emailEnv) throw new Error("JOBS_ACTOR_EMAIL tanımlı değil (config.manage yetkili kullanıcı e-postası)");
const email: string = emailEnv;
const intervalS = validateRuntimeConfig(process.env, { production: false }).limits.jobsIntervalSeconds;

const prisma = createPrisma(url);

async function tick(): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) throw new Error("JOBS_ACTOR_EMAIL ile eşleşen kullanıcı yok");
  const now = new Date();
  const actor = await loadActorContext(prisma, user.id, now);
  const result = await runAllJobs(prisma, { actor, now, correlationId: uuidv7() });
  process.stdout.write(`${JSON.stringify({ at: now.toISOString(), ...result })}\n`);
}

async function main(): Promise<void> {
  for (;;) {
    try {
      await tick();
    } catch (err) {
      console.error(JSON.stringify({ at: new Date().toISOString(), error: err instanceof Error ? err.message : "BILINMEYEN" }));
      if (once) process.exitCode = 1;
    }
    if (once) break;
    await new Promise((r) => setTimeout(r, intervalS * 1000));
  }
  await prisma.$disconnect();
}

void main();
