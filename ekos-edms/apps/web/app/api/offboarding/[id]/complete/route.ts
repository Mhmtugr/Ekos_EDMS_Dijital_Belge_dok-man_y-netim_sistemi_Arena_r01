// Ayrılışı tamamlar: hesap DISABLED. Engelleyici modda açık kalem varsa reddedilir. Yetki: user.manage.
import { completeOffboarding } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { intOrNull } from "@/lib/server/governance-input";
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
    const expectedRowVersion = b ? intOrNull(b.expectedRowVersion) : null;
    if (expectedRowVersion === null) return Response.json({ code: "VALIDATION_FAILED", correlationId: cid }, { status: 422 });
    const res = await completeOffboarding(db(), { actor: auth.actor, now: new Date(), correlationId: cid, caseId: id, expectedRowVersion });
    return Response.json({ ...res, correlationId: cid }, { status: 200 });
  } catch (err) {
    return errorResponse(err, cid);
  }
}
