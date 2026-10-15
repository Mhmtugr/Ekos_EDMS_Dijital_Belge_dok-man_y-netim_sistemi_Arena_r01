// Fiziksel orijinalin doğrulanması (konum kaydı olmalıdır).
import { verifyOriginal } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { errorResponse, newCorrelationId } from "@/lib/server/http";
import { isUuid, readJsonObject, requireApiActor, versionField } from "@/lib/server/request";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const cid = newCorrelationId();
  const json = (body: Record<string, unknown>, status: number): Response => Response.json({ ...body, correlationId: cid }, { status });
  const auth = await requireApiActor(req);
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  if (!isUuid(id)) return json({ code: "NOT_FOUND" }, 404);
  const b = await readJsonObject(req);
  if (!b) return json({ code: "VALIDATION_FAILED" }, 400);
  const expected = versionField(b, "expectedRowVersion");
  if (expected === null) return json({ code: "VALIDATION_FAILED", message: "Kayıt sürümü eksik" }, 400);
  try {
    await verifyOriginal(db(), { actor: auth.actor, now: new Date(), correlationId: cid, documentId: id, expectedRowVersion: expected });
    return json({ ok: true }, 200);
  } catch (err) {
    return errorResponse(err, cid);
  }
}
