// Ayrılış kalemi: devir (transfer) veya gerekçeli bırakma (waive; yalnız engellemeyen modda). Yetki: user.manage.
import { transferOffboardingItem, waiveOffboardingItem } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { intOrNull } from "@/lib/server/governance-input";
import { isUuid, readJsonObject, requireApiActor, strField } from "@/lib/server/request";
import { errorResponse, newCorrelationId } from "@/lib/server/http";

export async function POST(req: Request, ctx: { params: Promise<{ id: string; itemId: string }> }): Promise<Response> {
  const cid = newCorrelationId();
  const auth = await requireApiActor(req);
  if ("response" in auth) return auth.response;
  try {
    const { id, itemId } = await ctx.params;
    if (!isUuid(id) || !isUuid(itemId)) return Response.json({ code: "NOT_FOUND", correlationId: cid }, { status: 404 });
    const b = await readJsonObject(req);
    const expectedRowVersion = b ? intOrNull(b.expectedRowVersion) : null;
    if (!b || expectedRowVersion === null) return Response.json({ code: "VALIDATION_FAILED", correlationId: cid }, { status: 422 });
    const now = new Date();
    if (b.action === "transfer") {
      const toUserId = typeof b.toUserId === "string" && isUuid(b.toUserId) ? b.toUserId : null;
      if (!toUserId) return Response.json({ code: "VALIDATION_FAILED", correlationId: cid }, { status: 422 });
      await transferOffboardingItem(db(), { actor: auth.actor, now, correlationId: cid, caseId: id, itemId, toUserId, expectedRowVersion });
      return Response.json({ correlationId: cid }, { status: 200 });
    }
    if (b.action === "waive") {
      const note = strField(b, "note", 2000);
      if (!note) return Response.json({ code: "REASON_REQUIRED", correlationId: cid }, { status: 422 });
      await waiveOffboardingItem(db(), { actor: auth.actor, now, correlationId: cid, caseId: id, itemId, note, expectedRowVersion });
      return Response.json({ correlationId: cid }, { status: 200 });
    }
    return Response.json({ code: "VALIDATION_FAILED", correlationId: cid }, { status: 422 });
  } catch (err) {
    return errorResponse(err, cid);
  }
}
