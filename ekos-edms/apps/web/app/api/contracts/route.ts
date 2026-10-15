// Sözleşme oluşturma (Faz 3). Yalnızca MANUAL kaynak; geçmiş içe aktarma bu uçtan yapılamaz (R-LC-06).
import type { ContractLifecycleStatus } from "@ekos/core";
import { createContract } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { hasActiveGrant } from "@/lib/server/grants";
import { actorFromRequest } from "@/lib/server/session";
import { errorResponse, newCorrelationId, sameOrigin } from "@/lib/server/http";
import { isUuid, readJsonObject, strField } from "@/lib/server/request";

export async function POST(req: Request): Promise<Response> {
  const cid = newCorrelationId();
  const json = (body: Record<string, unknown>, status: number): Response => Response.json({ ...body, correlationId: cid }, { status });
  if (!sameOrigin(req)) return json({ code: "CSRF_REJECTED" }, 403);
  try {
    const actor = await actorFromRequest(req);
    if (!actor) return json({ code: "UNAUTHENTICATED" }, 401);
    if (!hasActiveGrant(actor, ["contract.create"])) return json({ code: "FORBIDDEN" }, 403);
    const b = await readJsonObject(req);
    const typeCode = b ? strField(b, "typeCode", 80) : null;
    const title = b ? strField(b, "title", 400) : null;
    const counterpartyId = b ? strField(b, "counterpartyId", 36) : null;
    if (!typeCode || !title || !counterpartyId || !isUuid(counterpartyId)) {
      return json({ code: "VALIDATION_FAILED", message: "Tür, başlık ve karşı taraf zorunludur" }, 400);
    }
    // Katalog türlerinin zorunlu metadata'sı (documentDate, YYYY-AA-GG). Karşı taraf ayrıca bağlanır.
    const documentDate = b ? strField(b, "documentDate", 10) : null;
    if (!documentDate) return json({ code: "VALIDATION_FAILED", message: "Belge tarihi (YYYY-AA-GG) zorunludur" }, 400);
    const departmentId = b ? strField(b, "departmentId", 36) : null;
    const fileObjectId = b ? strField(b, "fileObjectId", 36) : null;
    const res = await createContract(db(), {
      actorId: actor.userId,
      correlationId: cid,
      typeCode,
      title,
      counterpartyId,
      metadata: { documentDate },
      origin: "MANUAL",
      departmentId: departmentId && isUuid(departmentId) ? departmentId : null,
      fileObjectId: fileObjectId && isUuid(fileObjectId) ? fileObjectId : null,
    });
    const status: ContractLifecycleStatus = res.status;
    return json({ contractId: res.contractId, documentId: res.documentId, number: res.number, status }, 201);
  } catch (err) {
    return errorResponse(err, cid);
  }
}
