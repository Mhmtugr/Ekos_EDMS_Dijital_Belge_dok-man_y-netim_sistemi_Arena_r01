// Uygulama içi bildirimlerim (yalnız kendi kayıtlarım), teslim durumlarıyla birlikte.
import { listMyNotifications } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { requireApiActor } from "@/lib/server/request";
import { errorResponse, newCorrelationId } from "@/lib/server/http";

export async function GET(req: Request): Promise<Response> {
  const cid = newCorrelationId();
  const auth = await requireApiActor(req);
  if ("response" in auth) return auth.response;
  try {
    const url = new URL(req.url);
    const unreadOnly = url.searchParams.get("unread") === "1";
    const items = await listMyNotifications(db(), { actor: auth.actor, unreadOnly, limit: 100 });
    return Response.json({ items, correlationId: cid });
  } catch (err) {
    return errorResponse(err, cid);
  }
}
