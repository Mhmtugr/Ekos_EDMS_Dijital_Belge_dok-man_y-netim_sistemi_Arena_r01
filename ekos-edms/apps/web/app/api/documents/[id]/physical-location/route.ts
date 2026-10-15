// Fiziksel konum güncelleme (kutu/dosya/raf). Sürüm çakışması rowVersion ile denetlenir.
import { setPhysicalLocation } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { errorResponse, newCorrelationId } from "@/lib/server/http";
import { isUuid, readJsonObject, requireApiActor, strField, versionField } from "@/lib/server/request";

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
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
  const loc = typeof b.location === "object" && b.location !== null ? (b.location as Record<string, unknown>) : {};
  const box = strField(loc, "box", 60);
  const file = strField(loc, "file", 60);
  const shelf = strField(loc, "shelf", 60);
  try {
    const res = await setPhysicalLocation(db(), {
      actor: auth.actor,
      now: new Date(),
      correlationId: cid,
      documentId: id,
      expectedRowVersion: expected,
      location: { box, file, shelf },
    });
    return json({ rowVersion: res.rowVersion }, 200);
  } catch (err) {
    return errorResponse(err, cid);
  }
}
