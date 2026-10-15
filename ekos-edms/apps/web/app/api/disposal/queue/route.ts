// İmha inceleme kuyruğu: yalnızca kullanıcının görebildiği belgeler (servis sorgusu içi görünürlük filtresi).
import { listDispositionQueue } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { requireApiActor } from "@/lib/server/request";
import { errorResponse, newCorrelationId } from "@/lib/server/http";

export async function GET(req: Request): Promise<Response> {
  const cid = newCorrelationId();
  const auth = await requireApiActor(req);
  if ("response" in auth) return auth.response;
  try {
    const items = await listDispositionQueue(db(), { actor: auth.actor, now: new Date() });
    return Response.json({ items: items.map((i) => ({ ...i, retentionDueAt: i.retentionDueAt, extendedUntil: i.extendedUntil })), correlationId: cid }, { status: 200 });
  } catch (err) {
    return errorResponse(err, cid);
  }
}
