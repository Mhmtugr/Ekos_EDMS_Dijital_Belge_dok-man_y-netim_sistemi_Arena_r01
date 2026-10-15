// Denetçi kanıt paketi (JSON, checksum'lu). Yetki: audit.export; belge kapsamı görünürlükle sınırlı. Dışa aktarma denetime yazılır.
import { buildEvidencePack } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { isUuid, requireApiActor } from "@/lib/server/request";
import { errorResponse, newCorrelationId } from "@/lib/server/http";

export async function GET(req: Request): Promise<Response> {
  const cid = newCorrelationId();
  const auth = await requireApiActor(req);
  if ("response" in auth) return auth.response;
  try {
    const q = new URL(req.url).searchParams;
    const from = q.get("from");
    const to = q.get("to");
    const departmentId = q.get("departmentId");
    const documentId = q.get("documentId");
    if (!from || !to) return Response.json({ code: "RANGE_INVALID", correlationId: cid }, { status: 422 });
    if (departmentId && !isUuid(departmentId)) return Response.json({ code: "VALIDATION_FAILED", correlationId: cid }, { status: 422 });
    if (documentId && !isUuid(documentId)) return Response.json({ code: "VALIDATION_FAILED", correlationId: cid }, { status: 422 });
    const { pack, sha256 } = await buildEvidencePack(db(), {
      actor: auth.actor, now: new Date(), correlationId: cid, from, to,
      departmentId: departmentId ?? null, documentId: documentId ?? null,
    });
    return new Response(JSON.stringify({ ...pack, sha256 }, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="kanit-paketi-${from}-${to}.json"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    return errorResponse(err, cid);
  }
}
