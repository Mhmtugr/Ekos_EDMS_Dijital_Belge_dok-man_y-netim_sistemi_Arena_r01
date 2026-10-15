// Mali yıl sonu takvimi. Yetki: config.manage. Harita yoksa FISCAL_YEAR_END başlangıcı çözülmez.
import { listFiscalYearEnds, setFiscalYearEnd } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { intOrNull, isoDate } from "@/lib/server/governance-input";
import { readJsonObject, requireApiActor } from "@/lib/server/request";
import { errorResponse, newCorrelationId } from "@/lib/server/http";

export async function GET(req: Request): Promise<Response> {
  const cid = newCorrelationId();
  const auth = await requireApiActor(req);
  if ("response" in auth) return auth.response;
  try {
    const items = await listFiscalYearEnds(db(), { actor: auth.actor, now: new Date() });
    return Response.json({ items, correlationId: cid }, { status: 200 });
  } catch (err) {
    return errorResponse(err, cid);
  }
}

export async function POST(req: Request): Promise<Response> {
  const cid = newCorrelationId();
  const auth = await requireApiActor(req);
  if ("response" in auth) return auth.response;
  try {
    const b = await readJsonObject(req);
    const year = b ? intOrNull(b.year) : null;
    const endDate = b ? isoDate(b.endDate) : null;
    const rvRaw = b ? b.expectedRowVersion : undefined;
    const hasRv = rvRaw !== null && rvRaw !== undefined;
    const expectedRowVersion = hasRv ? intOrNull(rvRaw) : null;
    if (year === null || endDate === null || (hasRv && expectedRowVersion === null)) {
      return Response.json({ code: "VALIDATION_FAILED", correlationId: cid }, { status: 422 });
    }
    const res = await setFiscalYearEnd(db(), { actor: auth.actor, now: new Date(), correlationId: cid, year, endDate, expectedRowVersion });
    return Response.json({ ...res, correlationId: cid }, { status: 200 });
  } catch (err) {
    return errorResponse(err, cid);
  }
}
