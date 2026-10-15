// EKOS worker süreci (Faz 2): OCR kuyruğunu işler. Yapılandırma eksikse AÇIK hatayla çıkar (sessiz düşüş yok).
// Gerekli: DATABASE_URL, STORAGE_ROOT. İsteğe bağlı: TESSERACT_BIN (varsayılan "tesseract"), WORKER_POLL_MS (5000).
// Bu süreç yalnızca gerçek OCR motoru yapılandırılmışsa iş alır; sahte sonuç üretmez.
import { FsObjectStorage, TesseractOcr } from "@ekos/adapters";
import { createPrisma, processOneOcrJob, recoverStaleOcrJobs } from "@ekos/db";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    console.error(`[worker] yapılandırma eksik: ${name}. Süreç başlatılmadı.`);
    process.exit(2);
  }
  return v;
}

const databaseUrl = requireEnv("DATABASE_URL");
const storageRoot = requireEnv("STORAGE_ROOT");
const tesseractBin = process.env.TESSERACT_BIN?.trim() || "tesseract";
const pollMs = Number(process.env.WORKER_POLL_MS ?? "5000");
if (!Number.isInteger(pollMs) || pollMs < 100) {
  console.error("[worker] WORKER_POLL_MS geçersiz (en az 100 ms tam sayı).");
  process.exit(2);
}

const prisma = createPrisma(databaseUrl);
const storage = new FsObjectStorage(storageRoot);
const ocr = new TesseractOcr({ binary: tesseractBin, timeoutMs: 120_000 });

let stopping = false;
const stop = (): void => {
  stopping = true;
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

const log = (msg: string, extra?: Record<string, unknown>): void => {
  process.stdout.write(`${JSON.stringify({ t: new Date().toISOString(), msg, ...extra })}\n`);
};

async function main(): Promise<void> {
  log("worker başladı", { tesseractBin, pollMs });
  let lastRecovery = 0;
  while (!stopping) {
    try {
      if (Date.now() - lastRecovery > 60_000) {
        lastRecovery = Date.now();
        const n = await recoverStaleOcrJobs(prisma, new Date(Date.now() - 15 * 60_000));
        if (n > 0) log("bayat OCR işleri kurtarıldı", { count: n });
      }
      const r = await processOneOcrJob({ prisma, storage, ocr });
      if (r) {
        log("OCR işi", { jobId: r.jobId, result: r.result });
        continue; // kuyrukta iş varsa beklemeden devam et
      }
    } catch (err) {
      log("işleme hatası", { error: err instanceof Error ? err.message : "bilinmeyen" });
    }
    await new Promise((res) => setTimeout(res, pollMs));
  }
  await prisma.$disconnect();
  log("worker durdu");
}

void main();
