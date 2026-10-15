// Kırılma-cam kararı: approve (breakglass.approve, talep edenden farklı), reject, revoke. Gerekçe zorunlu (red/iptal).
import { approveBreakGlass, rejectBreakGlass, revokeBreakGlass } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { isUuid, readJsonObject, requireApiActor, strField } from "@/lib/server/request";
import { errorResponse, newCorrelationId } from "@/lib/server/http";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const cid = newCorrelationId();
  const auth = await requireApiActor(req);
  if ("response" in auth) return auth.response;
  try {
    const { id } = await ctx.params;
    if (!isUuid(id)) return Response.json({ code: "NOT_FOUND", correlationId: cid }, { status: 404 });
    const b = await readJsonObject(req);
    const action = b && typeof b.action === "string" ? b.action : null;
    const now = new Date();
    const base = { actor: auth.actor, now, correlationId: cid, grantId: id };
    if (action === "approve") {
      const res = await approveBreakGlass(db(), base);
      return Response.json({ startsAt: res.startsAt, expiresAt: res.expiresAt, correlationId: cid }, { status: 200 });
    }
    const reason = b ? strField(b, "reason", 2000) : null;
    if (!reason) return Response.json({ code: "REASON_REQUIRED", correlationId: cid }, { status: 422 });
    if (action === "reject") await rejectBreakGlass(db(), { ...base, reason });
    else if (action === "revoke") await revokeBreakGlass(db(), { ...base, reason });
    else return Response.json({ code: "VALIDATION_FAILED", correlationId: cid }, { status: 422 });
    return Response.json({ correlationId: cid }, { status: 200 });
  } catch (err) {
    return errorResponse(err, cid);
  }
}
