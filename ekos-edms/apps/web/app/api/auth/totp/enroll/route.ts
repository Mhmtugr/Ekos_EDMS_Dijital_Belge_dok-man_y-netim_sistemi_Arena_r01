// TOTP kurulumu: yeni sır üretir ve yalnızca bir kez gösterir. Etkinleşmek için /confirm gerekir.
import { beginTotpEnrollment } from "@ekos/db";
import { db, totpKey } from "@/lib/server/runtime";
import { errorResponse, newCorrelationId } from "@/lib/server/http";
import { requireApiActor } from "@/lib/server/request";

export async function POST(req: Request): Promise<Response> {
  const cid = newCorrelationId();
  const auth = await requireApiActor(req);
  if ("response" in auth) return auth.response;
  try {
    const key = totpKey();
    if (!key) return Response.json({ code: "SERVICE_UNAVAILABLE", message: "TOTP anahtarı yapılandırılmadı.", correlationId: cid }, { status: 503 });
    const res = await beginTotpEnrollment(db(), { userId: auth.actor.userId, key, now: new Date(), correlationId: cid });
    if (res === "ALREADY_ENABLED") return Response.json({ code: "IDEMPOTENCY_CONFLICT", message: "İki adımlı doğrulama zaten etkin.", correlationId: cid }, { status: 409 });
    return Response.json({ secretBase32: res.secretBase32, otpauthUri: res.otpauthUri, correlationId: cid }, { status: 200 });
  } catch (err) {
    return errorResponse(err, cid);
  }
}
