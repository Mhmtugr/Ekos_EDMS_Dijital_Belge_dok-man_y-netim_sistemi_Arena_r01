// İmza kanıtı kaydı ve ACTIVE geçişi (Faz 3, R-LC-04/05). Kanıt yoksa sözleşme aktif olmaz.
import { recordSignatureAndActivate } from "@ekos/db";
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
    if (!hasActiveGrant(actor, ["contract.record_signature"])) return json({ code: "FORBIDDEN" }, 403);
    const b = await readJsonObject(req);
    const signedAtRaw = b ? strField(b, "signedAt", 10) : null;
    const signatureMethod = b ? strField(b, "signatureMethod", 80) : null;
    const signerSummary = b ? strField(b, "signerSummary", 1000) : null;
    const signedAt = signedAtRaw ? new Date(`${signedAtRaw}T00:00:00Z`) : null;
    if (!signedAt || Number.isNaN(signedAt.getTime()) || !signatureMethod || !signerSummary) {
      return json({ code: "VALIDATION_FAILED", message: "İmza tarihi (YYYY-AA-GG), yöntem ve imzacı zorunludur" }, 400);
    }
    const res = await recordSignatureAndActivate(db(), {
      contractId: id, actorId: actor.userId, correlationId: cid, signedAt, signatureMethod, signerSummary,
    });
    return json({ status: res.status, versionId: res.versionId }, 200);
  } catch (err) {
    return errorResponse(err, cid);
  }
}
