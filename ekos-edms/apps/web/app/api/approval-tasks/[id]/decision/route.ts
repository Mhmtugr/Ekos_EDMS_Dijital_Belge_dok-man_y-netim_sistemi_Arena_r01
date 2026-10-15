// Onay kararı (Faz 3). Kendi onayını engelleme ve gerekçe kuralları servis katmanındadır (R-WF-03, R-DB-05).
import type { DecisionKind } from "@ekos/core";
import { decideApprovalTask } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { hasActiveGrant } from "@/lib/server/grants";
import { actorFromRequest } from "@/lib/server/session";
import { errorResponse, newCorrelationId, sameOrigin } from "@/lib/server/http";
import { isUuid, readJsonObject, strField } from "@/lib/server/request";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const cid = newCorrelationId();
  const json = (body: Record<string, unknown>, status: number): Response => Response.json({ ...body, correlationId: cid }, { status });
  if (!sameOrigin(req)) return json({ code: "CSRF_REJECTED" }, 403);
  try {
    const actor = await actorFromRequest(req);
    if (!actor) return json({ code: "UNAUTHENTICATED" }, 401);
    const { id } = await ctx.params;
    if (!isUuid(id)) return json({ code: "NOT_FOUND" }, 404);
    if (!hasActiveGrant(actor, ["document.approve"])) return json({ code: "FORBIDDEN" }, 403);
    const b = await readJsonObject(req);
    const d = b ? strField(b, "decision", 10) : null;
    if (d !== "APPROVE" && d !== "REJECT" && d !== "RETURN") return json({ code: "VALIDATION_FAILED", message: "Karar APPROVE, REJECT veya RETURN olmalıdır" }, 400);
    const decision: DecisionKind = d;
    const reason = b ? strField(b, "reason", 2000) : null;
    const res = await decideApprovalTask(db(), { taskId: id, actorId: actor.userId, decision, reason, correlationId: cid });
    return json({ ...res }, 200);
  } catch (err) {
    return errorResponse(err, cid);
  }
}
