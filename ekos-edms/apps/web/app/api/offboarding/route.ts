// Ayrılış dosyası açma: sorumluluk taraması, oturum kapatma, hesap OFFBOARDING. Yetki: user.manage.
import { listOffboardingCases, openOffboardingCase } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { readJsonObject, requireApiActor, isUuid, strField } from "@/lib/server/request";
import { errorResponse, newCorrelationId } from "@/lib/server/http";

export async function POST(req: Request): Promise<Response> {
  const cid = newCorrelationId();
  const auth = await requireApiActor(req);
  if ("response" in auth) return auth.response;
  try {
    const b = await readJsonObject(req);
    const userId = b && typeof b.userId === "string" && isUuid(b.userId) ? b.userId : null;
    const reason = b ? strField(b, "reason", 2000) : null;
    const blockOnUnresolved = b ? b.blockOnUnresolved === true : true;
    if (!userId || !reason) return Response.json({ code: "VALIDATION_FAILED", correlationId: cid }, { status: 422 });
    const res = await openOffboardingCase(db(), { actor: auth.actor, now: new Date(), correlationId: cid, userId, reason, blockOnUnresolved });
    return Response.json({ ...res, correlationId: cid }, { status: 201 });
  } catch (err) {
    return errorResponse(err, cid);
  }
}

/** Ayrılış dosyası listesi. Filtre: ?status=OPEN|COMPLETED|CANCELLED. Yetki: user.manage. */
export async function GET(req: Request): Promise<Response> {
  const cid = newCorrelationId();
  const auth = await requireApiActor(req);
  if ("response" in auth) return auth.response;
  try {
    const st = new URL(req.url).searchParams.get("status");
    if (st !== null && st !== "OPEN" && st !== "COMPLETED" && st !== "CANCELLED") {
      return Response.json({ code: "VALIDATION_FAILED", correlationId: cid }, { status: 422 });
    }
    const items = await listOffboardingCases(db(), { actor: auth.actor, now: new Date(), status: st });
    return Response.json({ items, correlationId: cid }, { status: 200 });
  } catch (err) {
    return errorResponse(err, cid);
  }
}
