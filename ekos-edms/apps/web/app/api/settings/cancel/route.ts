// Bekleyen kritik ayar önerisini iptal et (öneren veya config.manage sahibi).
import { cancelSettingChange } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { readJsonObject, requireApiActor, strField } from "@/lib/server/request";
import { errorResponse, newCorrelationId } from "@/lib/server/http";

export async function POST(req: Request): Promise<Response> {
  const cid = newCorrelationId();
  const auth = await requireApiActor(req);
  if ("response" in auth) return auth.response;
  try {
    const b = await readJsonObject(req);
    const key = b ? strField(b, "key", 100) : null;
    const expectedRowVersion = b && typeof b.expectedRowVersion === "number" && Number.isInteger(b.expectedRowVersion) ? b.expectedRowVersion : null;
    if (!key || expectedRowVersion === null) return Response.json({ code: "VALIDATION_FAILED", correlationId: cid }, { status: 422 });
    await cancelSettingChange(db(), { actor: auth.actor, now: new Date(), correlationId: cid, key, expectedRowVersion });
    return Response.json({ ok: true, correlationId: cid });
  } catch (err) {
    return errorResponse(err, cid);
  }
}
