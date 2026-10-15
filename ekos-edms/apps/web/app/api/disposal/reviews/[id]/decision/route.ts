// İmha incelemesi kararı. İnceleyen → ikinci ve farklı onaycı. Yetki ve profil onaycısı servis katmanında.
import { decideDispositionReview } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { intOrNull, isoDate } from "@/lib/server/governance-input";
import { isUuid, readJsonObject, requireApiActor, strField } from "@/lib/server/request";
import { errorResponse, newCorrelationId } from "@/lib/server/http";

const DECISIONS = ["APPROVE", "EXTEND", "REJECT"] as const;
type Decision = (typeof DECISIONS)[number];

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const cid = newCorrelationId();
  const auth = await requireApiActor(req);
  if ("response" in auth) return auth.response;
  try {
    const { id } = await ctx.params;
    if (!isUuid(id)) return Response.json({ code: "NOT_FOUND", correlationId: cid }, { status: 404 });
    const b = await readJsonObject(req);
    const decision = b && typeof b.decision === "string" && (DECISIONS as readonly string[]).includes(b.decision) ? (b.decision as Decision) : null;
    const reason = b ? strField(b, "reason", 2000) : null;
    const expectedRowVersion = b ? intOrNull(b.expectedRowVersion) : null;
    if (!decision || !reason || expectedRowVersion === null) return Response.json({ code: "VALIDATION_FAILED", correlationId: cid }, { status: 422 });
    const extendedUntil = b && b.extendedUntil !== undefined ? isoDate(b.extendedUntil) : null;
    const physicalEvidenceRef = b && typeof b.physicalEvidenceRef === "string" ? b.physicalEvidenceRef : null;
    const res = await decideDispositionReview(db(), {
      actor: auth.actor, now: new Date(), correlationId: cid, reviewId: id, expectedRowVersion, decision, reason,
      extendedUntil, physicalEvidenceRef,
    });
    return Response.json({ ...res, correlationId: cid }, { status: 200 });
  } catch (err) {
    return errorResponse(err, cid);
  }
}
