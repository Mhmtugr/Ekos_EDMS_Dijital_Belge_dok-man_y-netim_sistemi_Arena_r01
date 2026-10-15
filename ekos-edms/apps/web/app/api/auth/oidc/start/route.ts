// Entra ID OIDC başlatma (kod akışı + PKCE + state + nonce). Yapılandırma yoksa 503 IDP_NOT_CONFIGURED; sahte giriş yoktur.
import { toApiError } from "@ekos/core";
import { createOidcLoginRequest } from "@ekos/db";
import { authorizeUrl, newPkce, readEntraConfig } from "@ekos/adapters";
import { authMode, db } from "@/lib/server/runtime";
import { newCorrelationId } from "@/lib/server/http";

export async function GET(): Promise<Response> {
  const cid = newCorrelationId();
  if (authMode() !== "oidc") return new Response(null, { status: 404 });
  const cfg = readEntraConfig(process.env);
  if (!cfg) return Response.json(toApiError("IDP_NOT_CONFIGURED", cid), { status: 503 });
  const p = newPkce();
  await createOidcLoginRequest(db(), { state: p.state, nonce: p.nonce, codeVerifier: p.verifier, now: new Date() });
  return new Response(null, { status: 302, headers: { Location: authorizeUrl(cfg, p), "Cache-Control": "no-store" } });
}
