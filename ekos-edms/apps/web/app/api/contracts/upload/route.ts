// Dosyalı sözleşme oluşturma: yetki → dosya karantinası → sözleşme kaydı (taslak) → (yapılandırılmışsa) tarama.
// Tarama yapılandırılmamışsa scan="NOT_CONFIGURED" döner; dosya taranmadan imzalanamaz (imza servisi reddeder).
import { authorize } from "@ekos/core";
import { createContract, registerUpload, scanFile } from "@ekos/db";
import { actorFromRequest } from "@/lib/server/session";
import { hasActiveGrant } from "@/lib/server/grants";
import { antivirus, authMode, db, storage } from "@/lib/server/runtime";
import { errorResponse, newCorrelationId, sameOrigin } from "@/lib/server/http";
import { limits } from "@/lib/server/limits";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request): Promise<Response> {
  const cid = newCorrelationId();
  const json = (body: Record<string, unknown>, status: number): Response => Response.json({ ...body, correlationId: cid }, { status });
  if (authMode() !== "local") return json({ code: "SERVICE_UNAVAILABLE" }, 503);
  if (!sameOrigin(req)) return json({ code: "CSRF_REJECTED" }, 403);
  try {
    const actor = await actorFromRequest(req);
    if (!actor) return json({ code: "UNAUTHENTICATED" }, 401);
    if (!hasActiveGrant(actor, ["contract.create"]) || !hasActiveGrant(actor, ["document.upload"])) return json({ code: "FORBIDDEN" }, 403);

    const form = await req.formData();
    const field = (name: string): string => {
      const v = form.get(name);
      return typeof v === "string" ? v.trim() : "";
    };
    const title = field("title");
    const documentDate = field("documentDate");
    const counterpartyId = field("counterpartyId");
    const departmentField = field("departmentId");
    const file = form.get("file");
    if (title === "" || title.length > 300) return json({ code: "VALIDATION_FAILED", message: "Başlık zorunludur (en çok 300 karakter)" }, 422);
    if (!DATE_RE.test(documentDate)) return json({ code: "VALIDATION_FAILED", message: "Belge tarihi YYYY-AA-GG biçiminde olmalıdır" }, 422);
    if (!UUID_RE.test(counterpartyId)) return json({ code: "VALIDATION_FAILED", message: "Karşı taraf seçilmelidir" }, 422);
    if (departmentField !== "" && !UUID_RE.test(departmentField)) return json({ code: "VALIDATION_FAILED", message: "Birim geçersiz" }, 422);
    if (!(file instanceof File) || file.size === 0) return json({ code: "VALIDATION_FAILED", message: "Sözleşme dosyası seçilmelidir" }, 422);
    if (file.size > limits().maxUploadBytes) return json({ code: "PAYLOAD_TOO_LARGE" }, 413);

    const typeRow = await db().documentType.findUnique({ where: { code: "SOZLESME" }, select: { id: true } });
    const departmentId = departmentField !== "" ? departmentField : null;
    const can = authorize({
      actor: actor,
      permission: "document.upload",
      now: new Date(),
      resource: {
        id: "00000000-0000-7000-8000-000000000000",
        kind: "DOCUMENT",
        departmentId,
        documentTypeId: typeRow?.id ?? null,
        counterpartyId,
      },
    });
    if (!can.allowed) return json({ code: "FORBIDDEN", message: "Bu birim veya karşı taraf için yükleme yetkiniz yok" }, 403);

    const bytes = new Uint8Array(await file.arrayBuffer());
    const reg = await registerUpload(
      { prisma: db(), storage: storage() },
      { actorId: actor.userId, correlationId: cid, filename: file.name, declaredMime: file.type, bytes, maxBytes: limits().maxUploadBytes },
    );
    if (reg.status === "REJECTED") return json({ code: "FILE_REJECTED", issues: reg.issues }, 422);

    const created = await createContract(db(), {
      actorId: actor.userId,
      correlationId: cid,
      typeCode: "SOZLESME",
      title,
      counterpartyId,
      metadata: { documentDate },
      origin: "MANUAL",
      departmentId,
      fileObjectId: reg.fileObjectId,
    });

    const av = antivirus();
    let scan: string = "NOT_CONFIGURED";
    if (av) {
      try {
        const s = await scanFile({ prisma: db(), storage: storage(), av }, { fileObjectId: reg.fileObjectId, actorId: actor.userId, correlationId: cid });
        scan = s.status;
      } catch {
        scan = "ERROR";
      }
    }
    return json({ contractId: created.contractId, documentId: created.documentId, number: created.number, status: created.status, scan }, 201);
  } catch (err) {
    return errorResponse(err, cid);
  }
}
