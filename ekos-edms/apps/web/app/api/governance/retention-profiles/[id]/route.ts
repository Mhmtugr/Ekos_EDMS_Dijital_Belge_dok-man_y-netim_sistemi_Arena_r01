// Saklama profili kural güncellemesi: yeni sürüm; hukuki doğrulama sıfırlanır. Yetki: config.manage.
import { updateRetentionProfile } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { intOrNull, profileInput } from "@/lib/server/governance-input";
import { isUuid, readJsonObject, requireApiActor } from "@/lib/server/request";
import { errorResponse, newCorrelationId } from "@/lib/server/http";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const cid = newCorrelationId();
  const auth = await requireApiActor(req);
  if ("response" in auth) return auth.response;
  try {
    const { id } = await ctx.params;
    if (!isUuid(id)) return Response.json({ code: "NOT_FOUND", correlationId: cid }, { status: 404 });
    const b = await readJsonObject(req);
    const profile = b ? profileInput(b) : null;
    const expectedRowVersion = b ? intOrNull(b.expectedRowVersion) : null;
    if (!profile || expectedRowVersion === null) return Response.json({ code: "VALIDATION_FAILED", correlationId: cid }, { status: 422 });
    const res = await updateRetentionProfile(db(), { actor: auth.actor, now: new Date(), correlationId: cid, profileId: id, expectedRowVersion, profile });
    return Response.json({ ...res, correlationId: cid }, { status: 200 });
  } catch (err) {
    return errorResponse(err, cid);
  }
}
