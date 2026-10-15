// Süre dolumu taraması (sistem işi). Yalnızca config.manage. Otomatik imha yapmaz; yalnızca inceleme kuyruğu açar.
import { authorize } from "@ekos/core";
import { scanDispositionCandidates } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { requireApiActor } from "@/lib/server/request";
import { errorResponse, newCorrelationId } from "@/lib/server/http";

export async function POST(req: Request): Promise<Response> {
  const cid = newCorrelationId();
  const auth = await requireApiActor(req);
  if ("response" in auth) return auth.response;
  try {
    const now = new Date();
    if (!authorize({ actor: auth.actor, permission: "config.manage", now }).allowed) return Response.json({ code: "FORBIDDEN", correlationId: cid }, { status: 403 });
    const summary = await scanDispositionCandidates(db(), { now, correlationId: cid });
    return Response.json({ ...summary, correlationId: cid }, { status: 200 });
  } catch (err) {
    return errorResponse(err, cid);
  }
}
