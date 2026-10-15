// Onay akışı başlatma (Faz 3). Yayımlı matris yoksa 422 WORKFLOW_NOT_STARTABLE (R-WF-02).
import { startContractApproval } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { hasActiveGrant } from "@/lib/server/grants";
import { isUuid } from "@/lib/server/request";
import { actorFromRequest } from "@/lib/server/session";
import { errorResponse, newCorrelationId, sameOrigin } from "@/lib/server/http";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const cid = newCorrelationId();
  const json = (body: Record<string, unknown>, status: number): Response => Response.json({ ...body, correlationId: cid }, { status });
  if (!sameOrigin(req)) return json({ code: "CSRF_REJECTED" }, 403);
  try {
    const actor = await actorFromRequest(req);
    if (!actor) return json({ code: "UNAUTHENTICATED" }, 401);
    const { id } = await ctx.params;
    if (!isUuid(id)) return json({ code: "NOT_FOUND" }, 404);
    if (!hasActiveGrant(actor, ["document.start_workflow"])) return json({ code: "FORBIDDEN" }, 403);
    const res = await startContractApproval(db(), { contractId: id, actorId: actor.userId, correlationId: cid });
    return json({ instanceId: res.instanceId, definitionVersionId: res.definitionVersionId }, 201);
  } catch (err) {
    return errorResponse(err, cid);
  }
}
