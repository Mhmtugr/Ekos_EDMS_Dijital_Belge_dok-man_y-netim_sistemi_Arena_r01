// Önizleme: yalnızca taranmış (CLEAN) dosya. Yanıt satır içi, önbelleksiz, betik çalıştırmayan CSP ile verilir.
import { getDocumentPreview } from "@ekos/db";
import { actorFromRequest } from "@/lib/server/session";
import { db, storage } from "@/lib/server/runtime";
import { errorResponse, newCorrelationId } from "@/lib/server/http";

const SAFE_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/tiff",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const cid = newCorrelationId();
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return Response.json({ code: "NOT_FOUND", correlationId: cid }, { status: 404 });
  try {
    const actor = await actorFromRequest(req);
    if (!actor) return Response.json({ code: "UNAUTHENTICATED", correlationId: cid }, { status: 401 });
    const r = await getDocumentPreview({ prisma: db(), storage: storage() }, { actor, now: new Date(), documentId: id, correlationId: cid });
    const mime = SAFE_MIME.has(r.mimeType) ? r.mimeType : "application/octet-stream";
    return new Response(new Uint8Array(r.bytes), {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(r.fileName)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (err) {
    return errorResponse(err, cid);
  }
}
