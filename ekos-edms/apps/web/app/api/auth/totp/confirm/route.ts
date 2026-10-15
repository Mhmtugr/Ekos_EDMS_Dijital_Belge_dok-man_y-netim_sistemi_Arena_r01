// TOTP onayı: kullanıcının uygulamasındaki 6 haneli kodla kurulumu etkinleştirir.
import { confirmTotpEnrollment } from "@ekos/db";
import { db, totpKey } from "@/lib/server/runtime";
import { errorResponse, newCorrelationId } from "@/lib/server/http";
import { readJsonObject, requireApiActor, strField } from "@/lib/server/request";

export async function POST(req: Request): Promise<Response> {
  const cid = newCorrelationId();
  const json = (body: Record<string, unknown>, status: number): Response => Response.json({ ...body, correlationId: cid }, { status });
  const auth = await requireApiActor(req);
  if ("response" in auth) return auth.response;
  const b = await readJsonObject(req);
  const code = b ? strField(b, "code", 6) : null;
  if (!code || !/^\d{6}$/.test(code)) return json({ code: "VALIDATION_FAILED", message: "6 haneli kod girin" }, 400);
  try {
    const key = totpKey();
    if (!key) return json({ code: "SERVICE_UNAVAILABLE", message: "TOTP anahtarı yapılandırılmadı." }, 503);
    const res = await confirmTotpEnrollment(db(), { userId: auth.actor.userId, key, code, now: new Date(), correlationId: cid });
    if (res === "NOT_PENDING") return json({ code: "VERSION_CONFLICT", message: "Bekleyen bir kurulum yok. Önce kurulumu başlatın." }, 409);
    if (res === "INVALID_CODE") return json({ code: "VALIDATION_FAILED", message: "Kod hatalı veya süresi dolmuş." }, 422);
    return json({ ok: true }, 200);
  } catch (err) {
    return errorResponse(err, cid);
  }
}
