// Denetim olayları (filtreli). Yalnızca kapsamsız audit.export. Filtreler: tarih aralığı (≤366 gün, Europe/Istanbul), olay türü, aktör, hedef türü, sonuç.
import { authorize } from "@ekos/core";
import { verifyAuditTable } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { isUuid, requireApiActor } from "@/lib/server/request";
import { errorResponse, newCorrelationId } from "@/lib/server/http";

const OUTCOMES = ["SUCCESS", "DENIED", "FAILED"] as const;
const ACTOR_TYPES = ["USER", "SYSTEM", "WORKER", "BREAK_GLASS"] as const;

export async function GET(req: Request): Promise<Response> {
  const cid = newCorrelationId();
  const auth = await requireApiActor(req);
  if ("response" in auth) return auth.response;
  try {
    const now = new Date();
    if (!authorize({ actor: auth.actor, permission: "audit.export", now }).allowed) return Response.json({ code: "FORBIDDEN", correlationId: cid }, { status: 403 });
    const q = new URL(req.url).searchParams;
    const from = q.get("from");
    const to = q.get("to");
    if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return Response.json({ code: "RANGE_INVALID", correlationId: cid }, { status: 422 });
    }
    const fromDate = new Date(`${from}T00:00:00+03:00`);
    const toDate = new Date(`${to}T23:59:59.999+03:00`);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate > toDate || (toDate.getTime() - fromDate.getTime()) / 86_400_000 > 366) {
      return Response.json({ code: "RANGE_INVALID", correlationId: cid }, { status: 422 });
    }
    const eventType = q.get("eventType");
    const actorId = q.get("actorId");
    const targetType = q.get("targetType");
    const outcome = q.get("outcome");
    const actorType = q.get("actorType");
    if (actorId && !isUuid(actorId)) return Response.json({ code: "VALIDATION_FAILED", correlationId: cid }, { status: 422 });
    if (outcome && !(OUTCOMES as readonly string[]).includes(outcome)) return Response.json({ code: "VALIDATION_FAILED", correlationId: cid }, { status: 422 });
    if (actorType && !(ACTOR_TYPES as readonly string[]).includes(actorType)) return Response.json({ code: "VALIDATION_FAILED", correlationId: cid }, { status: 422 });
    const limit = Math.min(Math.max(Number(q.get("limit") ?? 200), 1), 500);
    const rows = await db().auditEvent.findMany({
      where: {
        occurredAt: { gte: fromDate, lte: toDate },
        ...(eventType ? { eventType } : {}),
        ...(actorId ? { actorId } : {}),
        ...(targetType ? { targetType } : {}),
        ...(outcome ? { outcome: outcome as (typeof OUTCOMES)[number] } : {}),
        ...(actorType ? { actorType: actorType as (typeof ACTOR_TYPES)[number] } : {}),
      },
      orderBy: { sequence: "desc" },
      take: limit,
    });
    const chain = await verifyAuditTable(db());
    return Response.json(
      {
        items: rows.map((r) => ({ ...r, sequence: r.sequence.toString() })),
        chainVerified: chain.ok,
        correlationId: cid,
      },
      { status: 200 },
    );
  } catch (err) {
    return errorResponse(err, cid);
  }
}
