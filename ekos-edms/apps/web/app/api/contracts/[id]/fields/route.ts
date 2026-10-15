// Sözleşme alanları (tarih, tutar, yenileme, ihbar). Yalnız taslak/incelemede; rowVersion zorunlu (eşzamanlılık).
import { updateContractFields } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { hasActiveGrant } from "@/lib/server/grants";
import { actorFromRequest } from "@/lib/server/session";
import { errorResponse, newCorrelationId, sameOrigin } from "@/lib/server/http";
import { isUuid, readJsonObject } from "@/lib/server/request";

const UNIT = ["CALENDAR_DAYS", "CALENDAR_MONTHS"] as const;

function str(v: unknown, max: number): string | null | undefined {
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length === 0 ? null : t.slice(0, max);
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const cid = newCorrelationId();
  const json = (body: Record<string, unknown>, status: number): Response => Response.json({ ...body, correlationId: cid }, { status });
  if (!sameOrigin(req)) return json({ code: "CSRF_REJECTED" }, 403);
  try {
    const actor = await actorFromRequest(req);
    if (!actor) return json({ code: "UNAUTHENTICATED" }, 401);
    const { id } = await ctx.params;
    if (!isUuid(id)) return json({ code: "NOT_FOUND" }, 404);
    if (!hasActiveGrant(actor, ["contract.create"])) return json({ code: "FORBIDDEN" }, 403);
    const b = await readJsonObject(req);
    if (!b) return json({ code: "VALIDATION_FAILED", message: "JSON gövdesi bekleniyor" }, 422);
    const expectedRowVersion = typeof b.expectedRowVersion === "number" && Number.isInteger(b.expectedRowVersion) ? b.expectedRowVersion : null;
    const raw = (typeof b.fields === "object" && b.fields !== null ? b.fields : null) as Record<string, unknown> | null;
    if (expectedRowVersion === null || !raw) return json({ code: "VALIDATION_FAILED", message: "rowVersion ve fields zorunlu" }, 422);

    const fields: Record<string, unknown> = {};
    const dates = ["effectiveDate", "startDate", "endDate"] as const;
    for (const k of dates) {
      if (k in raw) {
        const v = str(raw[k], 10);
        if (v === undefined) return json({ code: "VALIDATION_FAILED", message: `${k} metin olmalı` }, 422);
        fields[k] = v;
      }
    }
    if ("autoRenewal" in raw) {
      if (raw.autoRenewal !== null && typeof raw.autoRenewal !== "boolean") return json({ code: "VALIDATION_FAILED", message: "autoRenewal true/false/null" }, 422);
      fields.autoRenewal = raw.autoRenewal;
    }
    if ("amount" in raw) {
      const v = str(raw.amount, 30);
      if (v === undefined) return json({ code: "VALIDATION_FAILED", message: "amount metin olmalı" }, 422);
      fields.amount = v;
    }
    if ("currency" in raw) {
      const v = str(raw.currency, 3);
      if (v === undefined) return json({ code: "VALIDATION_FAILED", message: "currency metin olmalı" }, 422);
      fields.currency = v;
    }
    if ("paymentTerms" in raw) {
      const v = str(raw.paymentTerms, 1000);
      if (v === undefined) return json({ code: "VALIDATION_FAILED", message: "paymentTerms metin olmalı" }, 422);
      fields.paymentTerms = v;
    }
    if ("noticePeriodValue" in raw) {
      if (raw.noticePeriodValue !== null && (typeof raw.noticePeriodValue !== "number" || !Number.isInteger(raw.noticePeriodValue))) {
        return json({ code: "VALIDATION_FAILED", message: "noticePeriodValue tam sayı veya null" }, 422);
      }
      fields.noticePeriodValue = raw.noticePeriodValue;
    }
    if ("noticePeriodUnit" in raw) {
      if (raw.noticePeriodUnit !== null && !(UNIT as readonly unknown[]).includes(raw.noticePeriodUnit)) {
        return json({ code: "VALIDATION_FAILED", message: "noticePeriodUnit CALENDAR_DAYS, CALENDAR_MONTHS veya null" }, 422);
      }
      fields.noticePeriodUnit = raw.noticePeriodUnit;
    }
    const res = await updateContractFields(db(), { actor, correlationId: cid, contractId: id, expectedRowVersion, fields: fields });
    return json({ rowVersion: res.rowVersion }, 200);
  } catch (err) {
    return errorResponse(err, cid);
  }
}
