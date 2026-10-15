// Bildirimi okundu olarak işaretle (yalnız kendi bildirimim).
import { markNotificationRead } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { isUuid, requireApiActor } from "@/lib/server/request";
import { errorResponse, newCorrelationId } from "@/lib/server/http";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const cid = newCorrelationId();
  const auth = await requireApiActor(req);
  if ("response" in auth) return auth.response;
  try {
    const { id } = await ctx.params;
    if (!isUuid(id)) return Response.json({ code: "NOT_FOUND", correlationId: cid }, { status: 404 });
    await markNotificationRead(db(), { actor: auth.actor, now: new Date(), notificationId: id });
    return Response.json({ ok: true, correlationId: cid });
  } catch (err) {
    return errorResponse(err, cid);
  }
}
