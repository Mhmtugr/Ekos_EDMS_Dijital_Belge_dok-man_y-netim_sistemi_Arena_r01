// Rapor dışa aktarma (CSV/XLSX). Yetki, kapsam, filigran ve audit servis katmanındadır (exportReport).
import { exportReport, REPORT_TYPE_KEYS, type ReportType } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { isUuid, readJsonObject, requireApiActor } from "@/lib/server/request";
import { errorResponse, newCorrelationId } from "@/lib/server/http";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: Request): Promise<Response> {
  const cid = newCorrelationId();
  const auth = await requireApiActor(req);
  if ("response" in auth) return auth.response;
  try {
    const b = await readJsonObject(req);
    if (!b) return Response.json({ code: "VALIDATION_FAILED", correlationId: cid }, { status: 422 });
    const type = typeof b.type === "string" && (REPORT_TYPE_KEYS as string[]).includes(b.type) ? (b.type as ReportType) : null;
    const format = b.format === "CSV" || b.format === "XLSX" ? b.format : null;
    if (!type || !format) return Response.json({ code: "VALIDATION_FAILED", correlationId: cid }, { status: 422 });
    const from = typeof b.from === "string" && DAY.test(b.from) ? b.from : undefined;
    const to = typeof b.to === "string" && DAY.test(b.to) ? b.to : undefined;
    const days = typeof b.days === "number" && Number.isInteger(b.days) && b.days >= 1 && b.days <= 366 ? b.days : undefined;
    const counterpartyId = typeof b.counterpartyId === "string" && isUuid(b.counterpartyId) ? b.counterpartyId : undefined;
    if ((b.from !== undefined && !from) || (b.to !== undefined && !to)) return Response.json({ code: "VALIDATION_FAILED", correlationId: cid }, { status: 422 });
    const out = await exportReport(db(), {
      actor: auth.actor,
      now: new Date(),
      correlationId: cid,
      type,
      format,
      filters: { from, to, days, counterpartyId },
      restricted: b.restricted === true,
    });
    return new Response(out.bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": out.mime,
        "Content-Disposition": `attachment; filename="${out.filename}"; filename*=UTF-8''${encodeURIComponent(out.filename)}`,
        "Cache-Control": "no-store",
        "X-Row-Count": String(out.rowCount),
        "X-Content-Sha256": out.sha256,
        "X-Correlation-Id": cid,
      },
    });
  } catch (err) {
    return errorResponse(err, cid);
  }
}
