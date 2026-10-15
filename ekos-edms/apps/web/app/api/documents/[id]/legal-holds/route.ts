// Hukuki bekletme listesi (GET) ve bekletme koyma (POST). Yetki: document.legal_hold (koyma), görünürlük (liste).
import { listLegalHolds, placeLegalHold } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { isUuid, readJsonObject, requireApiActor, strField } from "@/lib/server/request";
import { errorResponse, newCorrelationId } from "@/lib/server/http";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const cid = newCorrelationId();
  const auth = await requireApiActor(req);
  if ("response" in auth) return auth.response;
  try {
    const { id } = await ctx.params;
    if (!isUuid(id)) return Response.json({ code: "NOT_FOUND", correlationId: cid }, { status: 404 });
    const holds = await listLegalHolds(db(), { actor: auth.actor, now: new Date(), documentId: id });
    return Response.json({ items: holds, correlationId: cid }, { status: 200 });
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
    const reason = b ? strField(b, "reason", 2000) : null;
    if (!reason) return Response.json({ code: "REASON_REQUIRED", correlationId: cid }, { status: 422 });
    const scopeNote = b && typeof b.scopeNote === "string" ? b.scopeNote : null;
    const res = await placeLegalHold(db(), { actor: auth.actor, now: new Date(), correlationId: cid, documentId: id, reason, scopeNote });
    return Response.json({ ...res, correlationId: cid }, { status: 201 });
  } catch (err) {
    return errorResponse(err, cid);
  }
}
