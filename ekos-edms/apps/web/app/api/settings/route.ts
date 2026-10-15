// Sistem ayarları (kurulum/yapılandırma). Yalnız config.manage. Kritik ayarlar önerilir; ikinci onaycı onaylar.
import { listSettings, saveSetting } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { readJsonObject, requireApiActor, strField } from "@/lib/server/request";
import { errorResponse, newCorrelationId } from "@/lib/server/http";

export async function GET(req: Request): Promise<Response> {
  const cid = newCorrelationId();
  const auth = await requireApiActor(req);
  if ("response" in auth) return auth.response;
  try {
    const items = await listSettings(db(), { actor: auth.actor, now: new Date() });
    return Response.json({ items, correlationId: cid });
  } catch (err) {
    return errorResponse(err, cid);
  }
}

export async function POST(req: Request): Promise<Response> {
  const cid = newCorrelationId();
  const auth = await requireApiActor(req);
  if ("response" in auth) return auth.response;
  try {
    const b = await readJsonObject(req);
    const key = b ? strField(b, "key", 100) : null;
    const expectedRowVersion = b && typeof b.expectedRowVersion === "number" && Number.isInteger(b.expectedRowVersion) ? b.expectedRowVersion : null;
    if (!key || expectedRowVersion === null || !b || !("value" in b)) {
      return Response.json({ code: "VALIDATION_FAILED", correlationId: cid }, { status: 422 });
    }
    const r = await saveSetting(db(), { actor: auth.actor, now: new Date(), correlationId: cid, key, value: b.value, expectedRowVersion });
    return Response.json({ ...r, correlationId: cid }, { status: r.status === "APPLIED" ? 200 : 202 });
  } catch (err) {
    return errorResponse(err, cid);
  }
}
