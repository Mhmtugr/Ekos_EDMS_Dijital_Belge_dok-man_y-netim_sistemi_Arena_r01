// Yönetim sayfaları için oturum kapısı: oturum yoksa giriş ekranına yönlendirir.
import { redirect } from "next/navigation";
import type { ActorContext } from "@ekos/core";
import { cookies } from "next/headers";
import { resolveSession } from "@ekos/db";
import { authMode, db } from "@/lib/server/runtime";
import { SESSION_COOKIE } from "@/lib/server/http";

export async function requireActor(): Promise<ActorContext> {
  if (authMode() !== "local") redirect("/giris");
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect("/giris");
  const actor = await resolveSession(db(), token, new Date());
  if (!actor) redirect("/giris");
  return actor;
}

export const INGEST_LABEL: Record<string, string> = {
  QUARANTINED: "Karantinada (taranıyor)",
  PROCESSING: "İşleniyor (OCR)",
  METADATA_PENDING: "Metadata bekliyor",
  READY: "Hazır",
  REJECTED: "Reddedildi",
  FAILED_RETRYABLE: "Hata (yeniden denenebilir)",
};
