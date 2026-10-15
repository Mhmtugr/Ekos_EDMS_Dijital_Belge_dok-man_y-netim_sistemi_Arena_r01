// Belge ilişkisi ekleme. Her iki belge için görünürlük ve izin servis katmanında (guardDocument) denetlenir.
import { linkDocuments, type RelationType } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { errorResponse, newCorrelationId } from "@/lib/server/http";
import { isUuid, readJsonObject, requireApiActor, strField } from "@/lib/server/request";

const TYPES: readonly RelationType[] = ["PARENT_CHILD", "ATTACHMENT", "REVISION", "ORDER_INVOICE", "CONTRACT_DOCUMENT", "AMENDMENT"];

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const cid = newCorrelationId();
  const json = (body: Record<string, unknown>, status: number): Response => Response.json({ ...body, correlationId: cid }, { status });
  const auth = await requireApiActor(req);
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  if (!isUuid(id)) return json({ code: "NOT_FOUND" }, 404);
  const b = await readJsonObject(req);
  if (!b) return json({ code: "VALIDATION_FAILED" }, 400);
  const toId = strField(b, "toId", 36);
  const relationType = strField(b, "relationType", 40);
  if (!toId || !isUuid(toId) || !relationType || !(TYPES as readonly string[]).includes(relationType)) {
    return json({ code: "VALIDATION_FAILED", message: "Hedef belge ve ilişki türü geçerli olmalıdır" }, 400);
  }
  try {
    const rel = await linkDocuments(db(), { actor: auth.actor, now: new Date(), correlationId: cid, fromId: id, toId, relationType: relationType as RelationType });
    return json({ id: rel.id }, 201);
  } catch (err) {
    return errorResponse(err, cid);
  }
}
