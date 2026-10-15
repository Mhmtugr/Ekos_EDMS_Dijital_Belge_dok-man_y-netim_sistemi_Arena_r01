// İstek yardımcıları: JSON gövdesi okuma, UUID doğrulama, oturumlu aktör alma (CSRF ve oturum denetimi dahil).
import type { ActorContext } from "@ekos/core";
import { actorFromRequest } from "./session";
import { sameOrigin } from "./http";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

export async function readJsonObject(req: Request): Promise<Record<string, unknown> | null> {
  if (req.headers.get("content-type")?.startsWith("application/json") !== true) return null;
  try {
    const body: unknown = await req.json();
    return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function strField(b: Record<string, unknown>, key: string, max: number): string | null {
  const v = b[key];
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 && t.length <= max ? t : null;
}

export function intField(b: Record<string, unknown>, key: string): number | null {
  const v = b[key];
  return typeof v === "number" && Number.isInteger(v) && v >= 1 ? v : null;
}

/** Fiziksel konum sürümü: kayıt yoksa 0 (servis sözleşmesi). */
export function versionField(b: Record<string, unknown>, key: string): number | null {
  const v = b[key];
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
}

/** Oturumlu, aynı-köken istekler için aktör. Yoksa yanıt döndürülür. */
export async function requireApiActor(
  req: Request,
): Promise<{ actor: ActorContext } | { response: Response }> {
  // CSRF: yalnızca durum değiştiren yöntemlerde Origin denetlenir (GET/HEAD tarayıcıda Origin göndermez).
  const safeMethod = req.method === "GET" || req.method === "HEAD";
  if (!safeMethod && !sameOrigin(req)) return { response: Response.json({ code: "CSRF_REJECTED" }, { status: 403 }) };
  const actor = await actorFromRequest(req);
  if (!actor) return { response: Response.json({ code: "UNAUTHENTICATED" }, { status: 401 }) };
  return { actor };
}
