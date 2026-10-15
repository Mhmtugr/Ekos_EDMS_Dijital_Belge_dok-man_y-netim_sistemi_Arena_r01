// Belge saklama durumu (GET) ve profil atama (POST). Politika eksikliği açıkça döner; uydurma süre yoktur.
import { assignRetentionProfile, getRetentionStatus } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { intOrNull } from "@/lib/server/governance-input";
import { isUuid, readJsonObject, requireApiActor } from "@/lib/server/request";
import { errorResponse, newCorrelationId } from "@/lib/server/http";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const cid = newCorrelationId();
  const auth = await requireApiActor(req);
  if ("response" in auth) return auth.response;
  try {
    const { id } = await ctx.params;
    if (!isUuid(id)) return Response.json({ code: "NOT_FOUND", correlationId: cid }, { status: 404 });
    const res = await getRetentionStatus(db(), { actor: auth.actor, now: new Date(), documentId: id });
    return Response.json({ ...res, correlationId: cid }, { status: 200 });
  } catch (err) {
    return errorResponse(err, cid);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const cid = newCorrelationId();
  const auth = await requireApiActor(req);
  if ("response" in auth) return auth.response;
  try {
    const { id } = await ctx.params;
    if (!isUuid(id)) return Response.json({ code: "NOT_FOUND", correlationId: cid }, { status: 404 });
    const b = await readJsonObject(req);
    const expectedRowVersion = b ? intOrNull(b.expectedRowVersion) : null;
    const profileId = b && (b.profileId === null || typeof b.profileId === "string") ? b.profileId : undefined;
    if (expectedRowVersion === null || profileId === undefined) return Response.json({ code: "VALIDATION_FAILED", correlationId: cid }, { status: 422 });
    await assignRetentionProfile(db(), { actor: auth.actor, now: new Date(), correlationId: cid, documentId: id, profileId, expectedRowVersion });
    return Response.json({ correlationId: cid }, { status: 200 });
  } catch (err) {
    return errorResponse(err, cid);
  }
}
