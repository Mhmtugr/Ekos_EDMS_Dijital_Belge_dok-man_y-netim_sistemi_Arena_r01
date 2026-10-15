// Kayıtlı görünümler: yalnızca sahibi görür/siler. Sorgu kriteri saklanır; sonuçlar her açılışta yetki filtresiyle yeniden hesaplanır.
import { createSavedView, type SavedCriteria } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { errorResponse, newCorrelationId } from "@/lib/server/http";
import { readJsonObject, requireApiActor, strField } from "@/lib/server/request";

const INGEST = ["QUARANTINED", "PROCESSING", "METADATA_PENDING", "READY", "REJECTED", "FAILED_RETRYABLE"];
const CONF = ["INTERNAL", "CONFIDENTIAL", "RESTRICTED", "HIGHLY_RESTRICTED"];

export async function POST(req: Request): Promise<Response> {
  const cid = newCorrelationId();
  const json = (body: Record<string, unknown>, status: number): Response => Response.json({ ...body, correlationId: cid }, { status });
  const auth = await requireApiActor(req);
  if ("response" in auth) return auth.response;
  const b = await readJsonObject(req);
  if (!b) return json({ code: "VALIDATION_FAILED" }, 400);
  const name = strField(b, "name", 120);
  const query = strField(b, "query", 200);
  if (!name || !query) return json({ code: "VALIDATION_FAILED", message: "Ad ve arama metni zorunludur" }, 400);
  const typeCode = strField(b, "typeCode", 40);
  const ingestStatus = strField(b, "ingestStatus", 40);
  const confidentiality = strField(b, "confidentiality", 40);
  if (ingestStatus !== null && !INGEST.includes(ingestStatus)) return json({ code: "VALIDATION_FAILED" }, 400);
  if (confidentiality !== null && !CONF.includes(confidentiality)) return json({ code: "VALIDATION_FAILED" }, 400);
  const criteria: SavedCriteria = {
    query,
    ...(typeCode !== null ? { typeCode } : {}),
    ...(ingestStatus !== null ? { ingestStatus } : {}),
    ...(confidentiality !== null ? { confidentiality } : {}),
  };
  try {
    const view = await createSavedView(db(), { ownerId: auth.actor.userId, name, criteria });
    return json({ id: view.id, name: view.name }, 201);
  } catch (err) {
    return errorResponse(err, cid);
  }
}
