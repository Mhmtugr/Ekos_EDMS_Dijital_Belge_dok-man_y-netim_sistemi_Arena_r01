// Kırılma-cam talebi: gerekçe, izin, belge ve süre (15–240 dk). Normal yetkisi olan talep edemez.
import { listBreakGlassGrants, requestBreakGlass } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { intOrNull } from "@/lib/server/governance-input";
import { isUuid, readJsonObject, requireApiActor, strField } from "@/lib/server/request";
import { errorResponse, newCorrelationId } from "@/lib/server/http";

export async function POST(req: Request): Promise<Response> {
  const cid = newCorrelationId();
  const auth = await requireApiActor(req);
  if ("response" in auth) return auth.response;
  try {
    const b = await readJsonObject(req);
    const documentId = b && typeof b.documentId === "string" && isUuid(b.documentId) ? b.documentId : null;
    const permission = b ? strField(b, "permission", 80) : null;
    const reason = b ? strField(b, "reason", 2000) : null;
    const durationMinutes = b ? intOrNull(b.durationMinutes) : null;
    if (!documentId || !permission || !reason || durationMinutes === null) return Response.json({ code: "VALIDATION_FAILED", correlationId: cid }, { status: 422 });
    const res = await requestBreakGlass(db(), { actor: auth.actor, now: new Date(), correlationId: cid, permission, documentId, reason, durationMinutes });
    return Response.json({ grantId: res.grantId, expiresAtIfApproved: res.expiresAtIfApproved, correlationId: cid }, { status: 201 });
  } catch (err) {
    return errorResponse(err, cid);
  }
}

export async function GET(req: Request): Promise<Response> {
  const cid = newCorrelationId();
  const auth = await requireApiActor(req);
  if ("response" in auth) return auth.response;
  try {
    const pageRaw = new URL(req.url).searchParams.get("page");
    const page = pageRaw === null ? 1 : Number(pageRaw);
    if (!Number.isInteger(page) || page < 1) return Response.json({ code: "VALIDATION_FAILED", correlationId: cid }, { status: 422 });
    const res = await listBreakGlassGrants(db(), { actor: auth.actor, now: new Date(), page });
    return Response.json({ ...res, correlationId: cid }, { status: 200 });
  } catch (err) {
    return errorResponse(err, cid);
  }
}
