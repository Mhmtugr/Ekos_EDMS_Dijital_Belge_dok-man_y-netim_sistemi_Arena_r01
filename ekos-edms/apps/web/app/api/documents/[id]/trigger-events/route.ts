// MANUAL_EVENT başlangıç olayı kaydı (yalnız eklenir). Yetki: document.retention_review.
import { recordRetentionTriggerEvent } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { isoDate } from "@/lib/server/governance-input";
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
    const eventDate = b ? isoDate(b.eventDate) : null;
    const note = b ? strField(b, "note", 2000) : null;
    if (!eventDate || !note) return Response.json({ code: "VALIDATION_FAILED", correlationId: cid }, { status: 422 });
    const res = await recordRetentionTriggerEvent(db(), { actor: auth.actor, now: new Date(), correlationId: cid, documentId: id, eventDate, note });
    return Response.json({ ...res, correlationId: cid }, { status: 201 });
  } catch (err) {
    return errorResponse(err, cid);
  }
}
