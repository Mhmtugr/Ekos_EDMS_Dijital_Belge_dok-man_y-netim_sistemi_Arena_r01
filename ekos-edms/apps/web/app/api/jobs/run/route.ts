// Hatırlatma döngüsünü ve bildirim teslim işçisini elle tetikle (config.manage). Zamanlı çalışma: scripts/run-jobs.ts.
import { db } from "@/lib/server/runtime";
import { requireApiActor } from "@/lib/server/request";
import { errorResponse, newCorrelationId } from "@/lib/server/http";
import { runAllJobs } from "@/lib/server/jobs";

export async function POST(req: Request): Promise<Response> {
  const cid = newCorrelationId();
  const auth = await requireApiActor(req);
  if ("response" in auth) return auth.response;
  try {
    const result = await runAllJobs(db(), { actor: auth.actor, now: new Date(), correlationId: cid });
    return Response.json({ ...result, correlationId: cid });
  } catch (err) {
    return errorResponse(err, cid);
  }
}
