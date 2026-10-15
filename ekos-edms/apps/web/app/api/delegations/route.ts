// Vekaletler: listele (kendi verdiklerim/aldıklarım) ve oluştur (gerekçe, süre ≤ 90 gün, vekil aktif olmalı).
import { createDelegation, listDelegations } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { isUuid, readJsonObject, requireApiActor, strField } from "@/lib/server/request";
import { errorResponse, newCorrelationId } from "@/lib/server/http";

export async function GET(req: Request): Promise<Response> {
  const cid = newCorrelationId();
  const auth = await requireApiActor(req);
  if ("response" in auth) return auth.response;
  try {
    // ?candidates=1: vekil adayları (yalnız aktif kullanıcının kimliği: id + ad). Yönetici izni gerektirmez.
    if (new URL(req.url).searchParams.get("candidates") === "1") {
      const users = await db().user.findMany({
        where: { status: "ACTIVE", id: { not: auth.actor.userId } },
        orderBy: { displayName: "asc" },
        take: 200,
        select: { id: true, displayName: true },
      });
      return Response.json({ items: users, correlationId: cid });
    }
    const items = await listDelegations(db(), { actor: auth.actor, now: new Date() });
    return Response.json({ items, correlationId: cid });
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
    const delegateId = b && typeof b.delegateId === "string" && isUuid(b.delegateId) ? b.delegateId : null;
    const reason = b ? strField(b, "reason", 500) : null;
    const startsAt = b && typeof b.startsAt === "string" ? new Date(b.startsAt) : null;
    const endsAt = b && typeof b.endsAt === "string" ? new Date(b.endsAt) : null;
    if (!delegateId || !reason || !startsAt || !endsAt || Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      return Response.json({ code: "VALIDATION_FAILED", correlationId: cid }, { status: 422 });
    }
    const r = await createDelegation(db(), { actor: auth.actor, now: new Date(), correlationId: cid, delegateId, startsAt, endsAt, reason });
    return Response.json({ id: r.id, correlationId: cid }, { status: 201 });
  } catch (err) {
    return errorResponse(err, cid);
  }
}
