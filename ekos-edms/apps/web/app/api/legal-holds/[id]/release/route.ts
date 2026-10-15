// Bekletme kaldırma. Gerekçe zorunlu. Yetki: document.legal_hold.
import { releaseLegalHold } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { isUuid, readJsonObject, requireApiActor, strField } from "@/lib/server/request";
import { errorResponse, newCorrelationId } from "@/lib/server/http";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const cid = newCorrelationId();
  const auth = await requireApiActor(req);
  if ("response" in auth) return auth.response;
  try {
    const { id } = await ctx.params;
    if (!isUuid(id)) return Response.json({ code: "NOT_FOUND", correlationId: cid }, { status: 404 });
    const b = await readJsonObject(req);
    const reason = b ? strField(b, "reason", 2000) : null;
    if (!reason) return Response.json({ code: "REASON_REQUIRED", correlationId: cid }, { status: 422 });
    const res = await releaseLegalHold(db(), { actor: auth.actor, now: new Date(), correlationId: cid, holdId: id, reason });
    return Response.json({ ...res, correlationId: cid }, { status: 200 });
  } catch (err) {
    return errorResponse(err, cid);
  }
}
