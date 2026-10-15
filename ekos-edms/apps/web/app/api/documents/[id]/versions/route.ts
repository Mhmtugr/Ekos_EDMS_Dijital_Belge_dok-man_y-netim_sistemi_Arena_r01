// Yeni sürüm: gerekçe + beklenen rowVersion + dosya. Eski sürüm korunur (salt-okunur); yeni sürüm karantinaya girer.
import { createNewVersion, guardDocument, registerUpload, scanFile } from "@ekos/db";
import { antivirus, db, storage } from "@/lib/server/runtime";
import { errorResponse, newCorrelationId } from "@/lib/server/http";
import { intField, isUuid, requireApiActor } from "@/lib/server/request";
import { limits } from "@/lib/server/limits";


export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const cid = newCorrelationId();
  const json = (body: Record<string, unknown>, status: number): Response => Response.json({ ...body, correlationId: cid }, { status });
  const auth = await requireApiActor(req);
  if ("response" in auth) return auth.response;
  const { actor } = auth;
  const { id } = await ctx.params;
  if (!isUuid(id)) return json({ code: "NOT_FOUND" }, 404);

  try {
    const doc = await guardDocument(db(), { actor, now: new Date(), documentId: id, permission: "document.new_version" });
    const form = await req.formData();
    const file = form.get("file");
    const reasonRaw = form.get("reason");
    const reason = typeof reasonRaw === "string" ? reasonRaw.trim() : "";
    const expectedRaw = form.get("expectedRowVersion");
    const expected = typeof expectedRaw === "string" ? intField({ v: Number(expectedRaw) }, "v") : null;
    if (!(file instanceof File)) return json({ code: "VALIDATION_FAILED", message: "Dosya seçilmedi" }, 400);
    if (file.size > limits().maxUploadBytes) return json({ code: "PAYLOAD_TOO_LARGE" }, 413);
    if (reason.length === 0 || reason.length > 500) return json({ code: "VALIDATION_FAILED", message: "Gerekçe 1–500 karakter olmalıdır" }, 400);
    if (expected === null) return json({ code: "VALIDATION_FAILED", message: "Kayıt sürümü eksik" }, 400);

    const reg = await registerUpload(
      { prisma: db(), storage: storage() },
      { actorId: actor.userId, correlationId: cid, filename: file.name, declaredMime: file.type, bytes: new Uint8Array(await file.arrayBuffer()), maxBytes: limits().maxUploadBytes },
    );
    if (reg.status === "REJECTED") return json({ code: "FILE_REJECTED", issues: reg.issues }, 422);

    const created = await createNewVersion(db(), {
      actorId: actor.userId,
      correlationId: cid,
      documentId: doc.id,
      expectedRowVersion: expected,
      fileObjectId: reg.fileObjectId,
      reason,
    });

    const av = antivirus();
    let scan: string = "NOT_CONFIGURED";
    if (av) {
      const s = await scanFile({ prisma: db(), storage: storage(), av }, { fileObjectId: reg.fileObjectId, actorId: actor.userId, correlationId: cid });
      scan = s.status;
    }
    return json({ versionNumber: created.versionNumber, rowVersion: created.rowVersion, scan }, 201);
  } catch (err) {
    return errorResponse(err, cid);
  }
}
