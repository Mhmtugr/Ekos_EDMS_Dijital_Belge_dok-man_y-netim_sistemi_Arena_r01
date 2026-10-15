// İmha yürütücüsü: yalnızca APPROVED incelemeleri yürütür. Yalnızca config.manage. Depo ve veritabanı aynı işlemde temizlenir.
import { authorize } from "@ekos/core";
import { runDispositionWorker } from "@ekos/db";
import { db, storage } from "@/lib/server/runtime";
import { isUuid, readJsonObject, requireApiActor } from "@/lib/server/request";
import { errorResponse, newCorrelationId } from "@/lib/server/http";

export async function POST(req: Request): Promise<Response> {
  const cid = newCorrelationId();
  const auth = await requireApiActor(req);
  if ("response" in auth) return auth.response;
  try {
    const now = new Date();
    if (!authorize({ actor: auth.actor, permission: "config.manage", now }).allowed) return Response.json({ code: "FORBIDDEN", correlationId: cid }, { status: 403 });
    const b = await readJsonObject(req);
    const reviewId = b && typeof b.reviewId === "string" && isUuid(b.reviewId) ? b.reviewId : undefined;
    const results = await runDispositionWorker(db(), { storage: storage(), now, correlationId: cid, ...(reviewId ? { reviewId } : {}) });
    return Response.json({ results, correlationId: cid }, { status: 200 });
  } catch (err) {
    return errorResponse(err, cid);
  }
}
