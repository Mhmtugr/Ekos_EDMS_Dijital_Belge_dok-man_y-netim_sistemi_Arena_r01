// Toplu içe aktarma: CSV manifest → kayıt → tarama (CLEAN olmadan başlamaz) → satır bazlı rapor.
// Yetki: belge oluşturma izni (document.upload). Tarama yapılandırılmamışsa 503 NOT_CONFIGURED (sahte "başarılı" yok).
import { registerManifest, scanFile, startManifestImport } from "@ekos/db";
import { antivirus, db, storage } from "@/lib/server/runtime";
import { errorResponse, newCorrelationId } from "@/lib/server/http";
import { requireApiActor } from "@/lib/server/request";
import { hasUnrestrictedGrant } from "@/lib/server/grants";
import { limits } from "@/lib/server/limits";


export async function POST(req: Request): Promise<Response> {
  const cid = newCorrelationId();
  const json = (body: Record<string, unknown>, status: number): Response => Response.json({ ...body, correlationId: cid }, { status });
  const auth = await requireApiActor(req);
  if ("response" in auth) return auth.response;
  const { actor } = auth;
  // Manifest satır başına birden çok belge oluşturur; satır bazında kapsam denetimi yoktur. Bu yüzden yalnızca
  // kurum geneli yükleme yetkisi olanlara açıktır (kapsamlı kullanıcı için yetki yükseltme olmasın).
  if (!hasUnrestrictedGrant(actor, "document.upload")) {
    return json({ code: "FORBIDDEN", message: "Toplu içe aktarma için kurum geneli belge yükleme yetkisi gerekir" }, 403);
  }

  try {
    const av = antivirus();
    if (!av) return json({ code: "NOT_CONFIGURED", message: "Tarama yapılandırılmadı; içe aktarma başlatılamaz." }, 503);
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return json({ code: "VALIDATION_FAILED", message: "Manifest dosyası seçilmedi" }, 400);
    if (file.size > limits().maxManifestBytes) return json({ code: "PAYLOAD_TOO_LARGE" }, 413);

    const deps = { prisma: db(), storage: storage(), av };
    const reg = await registerManifest(deps, {
      actorId: actor.userId,
      correlationId: cid,
      filename: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    const scan = await scanFile(deps, { fileObjectId: reg.fileObjectId, actorId: actor.userId, correlationId: cid });
    if (scan.status !== "CLEAN") return json({ code: "FILE_NOT_CLEAN", scan: scan.status }, 422);

    const report = await startManifestImport(deps, { actorId: actor.userId, correlationId: cid, fileObjectId: reg.fileObjectId });
    return json({ ...report }, 200);
  } catch (err) {
    return errorResponse(err, cid);
  }
}
