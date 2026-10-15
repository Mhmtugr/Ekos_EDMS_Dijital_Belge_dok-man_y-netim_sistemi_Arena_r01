// Kayıtlı görünüm silme (yalnızca sahibi).
import { deleteSavedView } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { errorResponse, newCorrelationId } from "@/lib/server/http";
import { isUuid, requireApiActor } from "@/lib/server/request";

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const cid = newCorrelationId();
  const auth = await requireApiActor(req);
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  if (!isUuid(id)) return Response.json({ code: "NOT_FOUND", correlationId: cid }, { status: 404 });
  try {
    await deleteSavedView(db(), { ownerId: auth.actor.userId, viewId: id });
    return Response.json({ ok: true, correlationId: cid }, { status: 200 });
  } catch (err) {
    return errorResponse(err, cid);
  }
}
