// Sağlık uç noktası (Faz 7). Gerçek kontroller: veritabanı (SELECT 1) ve depolama (yazılabilirlik).
// Antivirüs ve OCR için yalnızca YAPILANDIRMA durumu bildirilir; canlı yoklama yapılmaz (dış sistem doğrulaması ayrı).
// Kritik kontrol başarısızsa 503 döner. Yanıtta sır, yol veya ayrıntılı hata metni YOKTUR.
import { access, constants } from "node:fs/promises";
import { db } from "../../../lib/server/runtime";

type Check = "ok" | "fail" | "NOT_CONFIGURED" | "CONFIGURED_NOT_PROBED";

export async function GET(): Promise<Response> {
  const checks: Record<"database" | "storage" | "antivirus" | "ocr", Check> = {
    database: "fail",
    storage: "fail",
    antivirus: process.env.CLAMD_HOST?.trim() ? "CONFIGURED_NOT_PROBED" : "NOT_CONFIGURED",
    ocr: process.env.TESSERACT_BIN?.trim() ? "CONFIGURED_NOT_PROBED" : "NOT_CONFIGURED",
  };

  try {
    await db().$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch {
    checks.database = "fail";
  }

  try {
    const root = process.env.STORAGE_ROOT?.trim();
    if (!root) throw new Error("STORAGE_ROOT yok");
    await access(root, constants.W_OK);
    checks.storage = "ok";
  } catch {
    checks.storage = "fail";
  }

  const healthy = checks.database === "ok" && checks.storage === "ok";
  return Response.json(
    { status: healthy ? "ok" : "unavailable", checks },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
