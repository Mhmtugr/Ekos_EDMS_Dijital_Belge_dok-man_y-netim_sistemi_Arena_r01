import { logout } from "@ekos/db";
import { db } from "@/lib/server/runtime";
import { readCookie, sameOrigin, sessionCookie, SESSION_COOKIE } from "@/lib/server/http";

export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return Response.json({ code: "CSRF_REJECTED" }, { status: 403 });
  const token = readCookie(req, SESSION_COOKIE);
  if (token) await logout(db(), token, new Date());
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Set-Cookie": sessionCookie(req, "", 0) },
  });
}
