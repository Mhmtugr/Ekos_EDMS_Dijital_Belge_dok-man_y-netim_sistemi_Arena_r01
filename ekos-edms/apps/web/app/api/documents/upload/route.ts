// Belge yükleme: yetki → karantina → belge kaydı → (yapılandırılmışsa) tarama.
// Tarama yapılandırılmamışsa yanıt scan="NOT_CONFIGURED" döner; dosya karantinada kalır ve belge hazır olmaz.
import { authorize, type ActorContext } from "@ekos/core";
import { createDocument, findVisibleExactDuplicates, registerUpload, scanFile } from "@ekos/db";
import { actorFromRequest } from "@/lib/server/session";
import { hasActiveGrant } from "@/lib/server/grants";
import { antivirus, authMode, db, storage } from "@/lib/server/runtime";
import { errorResponse, newCorrelationId, sameOrigin } from "@/lib/server/http";
import { limits } from "@/lib/server/limits";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function realIsoDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Yükleyenin birimi: tüm üyeliklerinde TEK bir departman varsa belge o birime atanır.
 * Kurum geneli kapsam (boş departmentIds) veya birden çok birim varsa atama yapılmaz (tahmin yok; null).
 */
function uploaderDepartmentId(actor: ActorContext): string | null {
  const sets = actor.memberships.map((m) => m.scope.departmentIds ?? []);
  if (sets.length === 0 || sets.some((s) => s.length === 0)) return null;
  const ids = [...new Set(sets.flat())];
  return ids.length === 1 ? (ids[0] ?? null) : null;
}

export async function POST(req: Request): Promise<Response> {
  const cid = newCorrelationId();
  const json = (body: Record<string, unknown>, status: number): Response => Response.json({ ...body, correlationId: cid }, { status });
  if (authMode() !== "local") return json({ code: "SERVICE_UNAVAILABLE" }, 503);
  if (!sameOrigin(req)) return json({ code: "CSRF_REJECTED" }, 403);

  try {
    const actor = await actorFromRequest(req);
    if (!actor) return json({ code: "UNAUTHENTICATED" }, 401);
    if (!hasActiveGrant(actor, ["document.upload"])) return json({ code: "FORBIDDEN" }, 403);

    const form = await req.formData();
    const field = (name: string): string => {
      const v = form.get(name);
      return typeof v === "string" ? v.trim() : "";
    };
    const typeCode = field("typeCode");
    const title = field("title");
    const documentDate = field("documentDate");
    const counterpartyId = field("counterpartyId");
    const departmentField = field("departmentId");
    if (departmentField !== "" && !UUID_RE.test(departmentField)) return json({ code: "VALIDATION_FAILED", message: "Birim geçersiz" }, 400);
    const amount = field("amount");
    const currency = field("currency").toUpperCase();
    const file = form.get("file");
    if (typeCode === "" || title === "" || title.length > 300) return json({ code: "VALIDATION_FAILED", message: "Tür ve başlık zorunludur" }, 400);
    if (!realIsoDate(documentDate)) return json({ code: "VALIDATION_FAILED", message: "Belge tarihi YYYY-AA-GG biçiminde olmalıdır" }, 400);
    // Kapsam kararı belge kaynağıyla verilir: birim/tür/karşı taraf kapsamı, yükleyenin üyeliğiyle eşleşmeli.
    const departmentId = departmentField !== "" ? departmentField : uploaderDepartmentId(actor);
    const typeRow = await db().documentType.findUnique({ where: { code: typeCode }, select: { id: true } });
    const can = authorize({
      actor,
      permission: "document.upload",
      now: new Date(),
      resource: {
        id: "00000000-0000-7000-8000-000000000000",
        kind: "DOCUMENT",
        departmentId,
        documentTypeId: typeRow?.id ?? null,
        counterpartyId: counterpartyId === "" ? null : counterpartyId,
      },
    });
    if (!can.allowed) return json({ code: "FORBIDDEN", message: "Bu birim veya tür için yükleme yetkiniz yok" }, 403);
    if (currency !== "" && !/^[A-Z]{3}$/.test(currency)) return json({ code: "VALIDATION_FAILED", message: "Para birimi ISO 4217 üç harf olmalıdır (ör. TRY)" }, 400);
    if (counterpartyId !== "" && !UUID_RE.test(counterpartyId)) return json({ code: "VALIDATION_FAILED", message: "Karşı taraf geçersiz" }, 400);
    if (!(file instanceof File)) return json({ code: "VALIDATION_FAILED", message: "Dosya seçilmedi" }, 400);
    if (file.size > limits().maxUploadBytes) return json({ code: "PAYLOAD_TOO_LARGE" }, 413);

    // Metadata yalnızca dolu alanlardan oluşur; zorunluluk ve biçim kontrolü servis katmanındadır (createDocument).
    const metadata: Record<string, string> = { documentDate };
    if (counterpartyId !== "") metadata.counterpartyId = counterpartyId;
    if (amount !== "") metadata.amount = amount;
    if (currency !== "") metadata.currency = currency;

    const bytes = new Uint8Array(await file.arrayBuffer());
    const reg = await registerUpload(
      { prisma: db(), storage: storage() },
      { actorId: actor.userId, correlationId: cid, filename: file.name, declaredMime: file.type, bytes, maxBytes: limits().maxUploadBytes },
    );
    if (reg.status === "REJECTED") return json({ code: "FILE_REJECTED", issues: reg.issues }, 422);

    const created = await createDocument(db(), {
      departmentId,
      actorId: actor.userId,
      correlationId: cid,
      typeCode,
      title,
      metadata,
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
    const doc = await db().document.findUniqueOrThrow({ where: { id: created.documentId }, select: { ingestStatus: true } });
    // Birebir kopya uyarısı (yalnız uyarı; yüklemeyi engellemez). Yalnızca yükleyenin görebildiği belgeler listelenir.
    const fo = await db().documentFileObject.findUniqueOrThrow({ where: { id: reg.fileObjectId }, select: { sha256: true } });
    const duplicates = await findVisibleExactDuplicates(db(), actor, { sha256: fo.sha256, excludeFileObjectId: reg.fileObjectId });
    return json({ documentId: created.documentId, number: created.number, ingestStatus: doc.ingestStatus, scan, duplicates }, 201);
  } catch (err) {
    return errorResponse(err, cid);
  }
}
