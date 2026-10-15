// Yürütülmüş imhalar (içeriksiz manifest özeti). Yetki: config.manage.
import { listExecutedDispositions } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { requireApiActor } from "@/lib/server/request";
import { errorResponse, newCorrelationId } from "@/lib/server/http";

export async function GET(req: Request): Promise<Response> {
  const cid = newCorrelationId();
  const auth = await requireApiActor(req);
  if ("response" in auth) return auth.response;
  try {
    const items = await listExecutedDispositions(db(), { actor: auth.actor, now: new Date() });
    return Response.json({ items, correlationId: cid }, { status: 200 });
  } catch (err) {
    return errorResponse(err, cid);
  }
}
