// Entra ID dönüş noktası. Kimlik belirteci RS256 + iss/aud/exp/nonce ile doğrulanır. Hata ayrıntısı kullanıcıya gösterilmez (yalnız kısa kod).
import { randomUUID } from "node:crypto";
import { IntegrationError, ENTRA_KEY, emailFromClaims, exchangeCode, expectedIssuer, fetchJwks, groupsFromClaims, readEntraConfig, verifyIdToken } from "@ekos/adapters";
import { completeOidcLogin, consumeOidcLoginRequest } from "@ekos/db";
import { toApiError } from "@ekos/core";
import { authMode, db } from "@/lib/server/runtime";
import { SESSION_MAX_AGE_S, sessionCookie } from "@/lib/server/http";

function fail(req: Request, code: string): Response {
  return new Response(null, { status: 303, headers: { Location: new URL(`/giris?error=${encodeURIComponent(code)}`, req.url).toString(), "Cache-Control": "no-store" } });
}

export async function GET(req: Request): Promise<Response> {
  const cid = randomUUID();
  if (authMode() !== "oidc") return new Response(null, { status: 404 });
  const cfg = readEntraConfig(process.env);
  if (!cfg) return Response.json(toApiError("IDP_NOT_CONFIGURED", cid), { status: 503 });

  const url = new URL(req.url);
  if (url.searchParams.has("error")) return fail(req, "IDP_DENIED");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || code.length > 2048 || state.length > 200) return fail(req, "IDP_STATE");

  const now = new Date();
  const pending = await consumeOidcLoginRequest(db(), state, now);
  if (!pending) return fail(req, "IDP_STATE");

  try {
    const { idToken } = await exchangeCode(cfg, { code, verifier: pending.codeVerifier });
    const jwks = await fetchJwks(cfg);
    const claims = verifyIdToken(idToken, {
      jwks,
      issuer: expectedIssuer(cfg.tenantId),
      audience: cfg.clientId,
      nonce: pending.nonce,
      nowUnixSeconds: Math.floor(now.getTime() / 1000),
    });
    const email = emailFromClaims(claims);
    if (!email) return fail(req, "IDP_NO_EMAIL");
    const result = await completeOidcLogin(db(), {
      providerKey: ENTRA_KEY,
      email,
      externalGroups: groupsFromClaims(claims),
      correlationId: cid,
      now,
      userAgent: req.headers.get("user-agent"),
    });
    if (!result.ok) return fail(req, result.reason);
    return new Response(null, {
      status: 303,
      headers: {
        Location: new URL("/yonetim", req.url).toString(),
        "Set-Cookie": sessionCookie(req, result.token, SESSION_MAX_AGE_S),
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const reason = e instanceof IntegrationError ? e.code : "IDP_FAILED";
    console.error(`[oidc] cid=${cid} code=${reason}`);
    return fail(req, reason);
  }
}
