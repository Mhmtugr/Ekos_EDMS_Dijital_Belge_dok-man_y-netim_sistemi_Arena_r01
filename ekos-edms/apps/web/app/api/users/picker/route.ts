// Kullanıcı seçici (yalnız aktif hesaplar). Yetki: user.manage.
import { searchActiveUsers } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { requireApiActor } from "@/lib/server/request";
import { errorResponse, newCorrelationId } from "@/lib/server/http";

export async function GET(req: Request): Promise<Response> {
  const cid = newCorrelationId();
  const auth = await requireApiActor(req);
  if ("response" in auth) return auth.response;
  try {
    const q = new URL(req.url).searchParams.get("q") ?? "";
    const items = await searchActiveUsers(db(), { actor: auth.actor, now: new Date(), q });
    return Response.json({ items, correlationId: cid }, { status: 200 });
  } catch (err) {
    return errorResponse(err, cid);
  }
}
