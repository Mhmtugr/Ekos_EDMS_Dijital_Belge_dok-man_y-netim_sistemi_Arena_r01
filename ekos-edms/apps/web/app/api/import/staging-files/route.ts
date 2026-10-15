// Toplu içe aktarma için dosya havuzu: dosyayı kayda alır (karantina) ve tarar. Belge oluşturmaz;
// manifest içe aktarması, dosya adıyla bu havuzdaki (sürümsüz) dosyaları eşleştirir.
import { registerUpload, scanFile } from "@ekos/db";
import { antivirus, db, storage } from "@/lib/server/runtime";
import { errorResponse, newCorrelationId } from "@/lib/server/http";
import { requireApiActor } from "@/lib/server/request";
import { hasActiveGrant } from "@/lib/server/grants";
import { limits } from "@/lib/server/limits";


export async function POST(req: Request): Promise<Response> {
  const cid = newCorrelationId();
  const json = (body: Record<string, unknown>, status: number): Response => Response.json({ ...body, correlationId: cid }, { status });
  const auth = await requireApiActor(req);
  if ("response" in auth) return auth.response;
  const { actor } = auth;
  // Havuz belge oluşturmaz (yalnız karantina + tarama): aktif yükleme yetkisi yeterlidir.
  if (!hasActiveGrant(actor, ["document.upload"])) return json({ code: "FORBIDDEN" }, 403);

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return json({ code: "VALIDATION_FAILED", message: "Dosya seçilmedi" }, 400);
    if (file.size > limits().maxUploadBytes) return json({ code: "PAYLOAD_TOO_LARGE" }, 413);

    const reg = await registerUpload(
      { prisma: db(), storage: storage() },
      { actorId: actor.userId, correlationId: cid, filename: file.name, declaredMime: file.type, bytes: new Uint8Array(await file.arrayBuffer()), maxBytes: limits().maxUploadBytes },
    );
    if (reg.status === "REJECTED") return json({ code: "FILE_REJECTED", issues: reg.issues }, 422);

    const av = antivirus();
    if (!av) return json({ fileObjectId: reg.fileObjectId, fileName: file.name, scan: "NOT_CONFIGURED" }, 201);
    const scan = await scanFile({ prisma: db(), storage: storage(), av }, { fileObjectId: reg.fileObjectId, actorId: actor.userId, correlationId: cid });
    return json({ fileObjectId: reg.fileObjectId, fileName: file.name, scan: scan.status }, 201);
  } catch (err) {
    return errorResponse(err, cid);
  }
}
