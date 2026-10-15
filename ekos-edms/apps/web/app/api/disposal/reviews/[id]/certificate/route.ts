// İmha tutanağı (PDF). Yetki: config.manage. Yalnızca yürütülmüş imha için; denetime yazılır.
import { buildDisposalCertificate } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { isUuid, requireApiActor } from "@/lib/server/request";
import { errorResponse, newCorrelationId } from "@/lib/server/http";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const cid = newCorrelationId();
  const auth = await requireApiActor(req);
  if ("response" in auth) return auth.response;
  try {
    const { id } = await ctx.params;
    if (!isUuid(id)) return Response.json({ code: "NOT_FOUND", correlationId: cid }, { status: 404 });
    const cert = await buildDisposalCertificate(db(), { actor: auth.actor, now: new Date(), correlationId: cid, reviewId: id });
    return new Response(Buffer.from(cert.bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${cert.filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Certificate-Sha256": cert.sha256,
      },
    });
  } catch (err) {
    return errorResponse(err, cid);
  }
}
