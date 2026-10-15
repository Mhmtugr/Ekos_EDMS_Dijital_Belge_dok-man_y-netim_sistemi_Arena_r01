// Ayrılış dosyası ve kalemleri. Yetki: user.manage.
import { getOffboardingCase } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { isUuid, requireApiActor } from "@/lib/server/request";
import { errorResponse, newCorrelationId } from "@/lib/server/http";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const cid = newCorrelationId();
  const auth = await requireApiActor(req);
  if ("response" in auth) return auth.response;
  try {
    const { id } = await ctx.params;
    if (!isUuid(id)) return Response.json({ code: "NOT_FOUND", correlationId: cid }, { status: 404 });
    const c = await getOffboardingCase(db(), { actor: auth.actor, now: new Date(), caseId: id });
    return Response.json({ ...c, correlationId: cid }, { status: 200 });
  } catch (err) {
    return errorResponse(err, cid);
  }
}
