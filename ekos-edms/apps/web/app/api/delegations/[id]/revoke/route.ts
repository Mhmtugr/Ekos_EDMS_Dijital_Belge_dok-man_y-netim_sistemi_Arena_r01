// Vekalet iptali: vekalet veren veya user.manage sahibi. rowVersion zorunlu (eşzamanlılık).
import { revokeDelegation } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { isUuid, readJsonObject, requireApiActor } from "@/lib/server/request";
import { errorResponse, newCorrelationId } from "@/lib/server/http";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const cid = newCorrelationId();
  const auth = await requireApiActor(req);
  if ("response" in auth) return auth.response;
  try {
    const { id } = await ctx.params;
    if (!isUuid(id)) return Response.json({ code: "NOT_FOUND", correlationId: cid }, { status: 404 });
    const b = await readJsonObject(req);
    const expectedRowVersion = b && typeof b.expectedRowVersion === "number" && Number.isInteger(b.expectedRowVersion) ? b.expectedRowVersion : null;
    if (expectedRowVersion === null) return Response.json({ code: "VALIDATION_FAILED", correlationId: cid }, { status: 422 });
    await revokeDelegation(db(), { actor: auth.actor, now: new Date(), correlationId: cid, delegationId: id, expectedRowVersion });
    return Response.json({ ok: true, correlationId: cid });
  } catch (err) {
    return errorResponse(err, cid);
  }
}
