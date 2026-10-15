// Saklama profili oluşturma (sürüm 1). Yetki: config.manage (servis katmanında). Evrensel varsayılan süre yoktur.
import { createRetentionProfile, listRetentionProfiles } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { profileInput } from "@/lib/server/governance-input";
import { readJsonObject, requireApiActor } from "@/lib/server/request";
import { errorResponse, newCorrelationId } from "@/lib/server/http";

export async function POST(req: Request): Promise<Response> {
  const cid = newCorrelationId();
  const auth = await requireApiActor(req);
  if ("response" in auth) return auth.response;
  try {
    const b = await readJsonObject(req);
    const profile = b ? profileInput(b) : null;
    if (!profile) return Response.json({ code: "VALIDATION_FAILED", correlationId: cid }, { status: 422 });
    const res = await createRetentionProfile(db(), { actor: auth.actor, now: new Date(), correlationId: cid, profile });
    return Response.json({ ...res, correlationId: cid }, { status: 201 });
  } catch (err) {
    return errorResponse(err, cid);
  }
}

export async function GET(req: Request): Promise<Response> {
  const cid = newCorrelationId();
  const auth = await requireApiActor(req);
  if ("response" in auth) return auth.response;
  try {
    const items = await listRetentionProfiles(db(), { actor: auth.actor, now: new Date() });
    return Response.json({ items, correlationId: cid }, { status: 200 });
  } catch (err) {
    return errorResponse(err, cid);
  }
}
