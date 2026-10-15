// Karşı taraflar: liste (belge yükleyenler için aktif kayıtlar) ve oluşturma (counterparty.manage).
import { authorize } from "@ekos/core";
import { createCounterparty, listActiveCounterparties } from "@ekos/db";
import { actorFromRequest } from "@/lib/server/session";
import { db } from "@/lib/server/runtime";
import { errorResponse, newCorrelationId, sameOrigin } from "@/lib/server/http";
import { readJsonObject, strField } from "@/lib/server/request";
import { hasActiveGrant } from "@/lib/server/grants";

export async function GET(req: Request): Promise<Response> {
  const cid = newCorrelationId();
  try {
    const actor = await actorFromRequest(req);
    if (!actor) return Response.json({ code: "UNAUTHENTICATED", correlationId: cid }, { status: 401 });
    const canList = hasActiveGrant(actor, ["document.upload", "counterparty.manage"]);
    if (!canList) return Response.json({ code: "FORBIDDEN", correlationId: cid }, { status: 403 });
    return Response.json({ items: await listActiveCounterparties(db()), correlationId: cid }, { status: 200 });
  } catch (err) {
    return errorResponse(err, cid);
  }
}

export async function POST(req: Request): Promise<Response> {
  const cid = newCorrelationId();
  const json = (body: Record<string, unknown>, status: number): Response => Response.json({ ...body, correlationId: cid }, { status });
  if (!sameOrigin(req)) return json({ code: "CSRF_REJECTED" }, 403);
  try {
    const actor = await actorFromRequest(req);
    if (!actor) return json({ code: "UNAUTHENTICATED" }, 401);
    if (!authorize({ actor, permission: "counterparty.manage", now: new Date() }).allowed) return json({ code: "FORBIDDEN" }, 403);
    const b = await readJsonObject(req);
    const officialName = b ? strField(b, "officialName", 300) : null;
    const countryCode = b ? strField(b, "countryCode", 2) : null;
    if (!officialName || !countryCode) return json({ code: "VALIDATION_FAILED", message: "Resmi ad ve ülke kodu zorunludur" }, 400);
    const supplierCode = b ? strField(b, "supplierCode", 60) : null;
    const cp = await createCounterparty(db(), { actorId: actor.userId, correlationId: cid, officialName, countryCode, supplierCode });
    return json({ id: cp.id }, 201);
  } catch (err) {
    return errorResponse(err, cid);
  }
}
