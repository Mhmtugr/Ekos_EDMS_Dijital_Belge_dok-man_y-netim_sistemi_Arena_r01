// Yerel giriş (AUTH_MODE=local). Hata yanıtları tek tiptir; parola/kod/belirteç günlüğe yazılmaz.
// İkinci faktör (TOTP) etkinse: parola doğru + kod yok → 401 TOTP_REQUIRED (sayaç artmaz).
import { toApiError } from "@ekos/core";
import { authenticateLocal } from "@ekos/db";
import { authMode, db, totpKey } from "@/lib/server/runtime";
import { passwordHasher } from "@/lib/server/passwords";
import { consumeRateLimit, clientIp } from "@/lib/server/rate-limit";
import { errorResponse, newCorrelationId, sameOrigin, sessionCookie, SESSION_MAX_AGE_S } from "@/lib/server/http";

/** IP başına 15 dakikada en çok 30 giriş denemesi (hesap kilidinden bağımsız ek koruma). */
const IP_POLICY = { max: 30, windowMs: 15 * 60 * 1000 } as const;

export async function POST(req: Request): Promise<Response> {
  const cid = newCorrelationId();
  const mode = authMode();
  if (mode === "oidc") return Response.json(toApiError("IDP_NOT_CONFIGURED", cid), { status: 503 });
  if (mode === "unset") return Response.json(toApiError("SERVICE_UNAVAILABLE", cid), { status: 503 });
  if (!sameOrigin(req)) return Response.json(toApiError("CSRF_REJECTED", cid), { status: 403 });
  if (req.headers.get("content-type")?.startsWith("application/json") !== true) {
    return Response.json(toApiError("VALIDATION_FAILED", cid), { status: 400 });
  }
  if (!consumeRateLimit(`login:${clientIp(req)}`, IP_POLICY)) {
    return Response.json(toApiError("RATE_LIMITED", cid), { status: 429, headers: { "Retry-After": "900" } });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(toApiError("VALIDATION_FAILED", cid), { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const email = typeof b.email === "string" ? b.email : "";
  const password = typeof b.password === "string" ? b.password : "";
  const totpCode = typeof b.totpCode === "string" && b.totpCode.trim() !== "" ? b.totpCode.trim() : null;
  if (email.length === 0 || email.length > 320 || password.length === 0 || password.length > 128) {
    return Response.json(toApiError("VALIDATION_FAILED", cid), { status: 400 });
  }
  if (totpCode !== null && !/^\d{6}$/.test(totpCode)) {
    return Response.json(toApiError("VALIDATION_FAILED", cid), { status: 400 });
  }

  try {
    const r = await authenticateLocal(db(), {
      email,
      password,
      now: new Date(),
      correlationId: cid,
      hasher: passwordHasher,
      userAgent: req.headers.get("user-agent"),
      totpKey: totpKey(),
      totpCode,
    });
    if (!r.ok) {
      if (r.reason === "TOTP_REQUIRED") {
        return Response.json({ code: "TOTP_REQUIRED", message: "Doğrulama kodu gerekli.", correlationId: cid }, { status: 401 });
      }
      if (r.reason === "TOTP_NOT_CONFIGURED") return Response.json(toApiError("SERVICE_UNAVAILABLE", cid), { status: 503 });
      return Response.json(toApiError("INVALID_CREDENTIALS", cid), { status: 401 });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Set-Cookie": sessionCookie(req, r.token, SESSION_MAX_AGE_S) },
    });
  } catch (err) {
    return errorResponse(err, cid);
  }
}
