// Microsoft Entra ID (OIDC, kod akışı + PKCE). Kimlik belirteci RS256 ile JWKS'ten doğrulanır (bağımlılık yok: node:crypto).
// Grup claim'i "overage" (>200 grup) ise grup bilgisi GELMEZ: bu durumda grup eşlemesi uygulanmaz (yetki yanlışlıkla silinmez).
import { createHash, createPublicKey, randomBytes, verify as cryptoVerify } from "node:crypto";
import { IntegrationError, readEnv, type Env } from "./types.js";

export const ENTRA_KEY = "entra-oidc";
export const ENTRA_REQUIRED_ENV = ["ENTRA_TENANT_ID", "ENTRA_CLIENT_ID", "ENTRA_CLIENT_SECRET", "ENTRA_REDIRECT_URI"] as const;

export interface EntraConfig {
  readonly tenantId: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

export function readEntraConfig(env: Env): EntraConfig | null {
  const tenantId = readEnv(env, "ENTRA_TENANT_ID");
  const clientId = readEnv(env, "ENTRA_CLIENT_ID");
  const clientSecret = readEnv(env, "ENTRA_CLIENT_SECRET");
  const redirectUri = readEnv(env, "ENTRA_REDIRECT_URI");
  if (!tenantId || !clientId || !clientSecret || !redirectUri) return null;
  return { tenantId, clientId, clientSecret, redirectUri };
}

export const base64url = (b: Buffer): string => b.toString("base64url");

export function newPkce(): { verifier: string; challenge: string; state: string; nonce: string } {
  const verifier = base64url(randomBytes(48));
  return {
    verifier,
    challenge: base64url(createHash("sha256").update(verifier).digest()),
    state: base64url(randomBytes(24)),
    nonce: base64url(randomBytes(24)),
  };
}

export function authorizeUrl(cfg: EntraConfig, p: { state: string; nonce: string; challenge: string }): string {
  const u = new URL(`https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/authorize`);
  u.search = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: "code",
    redirect_uri: cfg.redirectUri,
    response_mode: "query",
    scope: "openid profile email",
    state: p.state,
    nonce: p.nonce,
    code_challenge: p.challenge,
    code_challenge_method: "S256",
  }).toString();
  return u.toString();
}

export const expectedIssuer = (tenantId: string): string => `https://login.microsoftonline.com/${tenantId}/v2.0`;

export async function exchangeCode(
  cfg: EntraConfig,
  p: { code: string; verifier: string },
  fetchFn: typeof fetch = fetch,
): Promise<{ idToken: string }> {
  let res: Response;
  try {
    res = await fetchFn(`https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        grant_type: "authorization_code",
        code: p.code,
        redirect_uri: cfg.redirectUri,
        code_verifier: p.verifier,
      }).toString(),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new IntegrationError("IDP_UNREACHABLE", true);
  }
  if (!res.ok) throw new IntegrationError(`IDP_TOKEN_HTTP_${String(res.status)}`, res.status >= 500);
  const body = (await res.json().catch(() => null)) as { id_token?: unknown } | null;
  if (!body || typeof body.id_token !== "string") throw new IntegrationError("IDP_TOKEN_MISSING", false);
  return { idToken: body.id_token };
}

export interface Jwk {
  readonly kid?: string;
  readonly kty: string;
  readonly n?: string;
  readonly e?: string;
  readonly alg?: string;
  readonly use?: string;
}

export interface IdTokenClaims {
  readonly iss: string;
  readonly aud: string | string[];
  readonly exp: number;
  readonly nbf?: number;
  readonly nonce?: string;
  readonly preferred_username?: string;
  readonly email?: string;
  readonly oid?: string;
  readonly groups?: string[];
  readonly _claim_names?: Record<string, unknown>;
}

const b64json = (s: string): unknown => JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as unknown;

/** RS256 imza + iss/aud/exp/nbf/nonce doğrulaması. Başarısızlıkta hata kodu döner (ayrıntı sızdırılmaz). */
export function verifyIdToken(
  idToken: string,
  p: { jwks: { keys: Jwk[] }; issuer: string; audience: string; nonce: string; nowUnixSeconds: number; skewS?: number },
): IdTokenClaims {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new IntegrationError("IDP_TOKEN_INVALID", false);
  const [h, c, s] = parts as [string, string, string];
  let header: { alg?: string; kid?: string };
  let claims: IdTokenClaims;
  try {
    header = b64json(h) as { alg?: string; kid?: string };
    claims = b64json(c) as IdTokenClaims;
  } catch {
    throw new IntegrationError("IDP_TOKEN_INVALID", false);
  }
  if (header.alg !== "RS256") throw new IntegrationError("IDP_TOKEN_ALG", false);
  const jwk = p.jwks.keys.find((k) => k.kid === header.kid && k.kty === "RSA");
  if (!jwk) throw new IntegrationError("IDP_KEY_NOT_FOUND", false);
  const key = createPublicKey({ key: jwk as unknown as Record<string, unknown>, format: "jwk" });
  const ok = cryptoVerify("RSA-SHA256", Buffer.from(`${h}.${c}`), key, Buffer.from(s, "base64url"));
  if (!ok) throw new IntegrationError("IDP_SIGNATURE_INVALID", false);
  const skew = p.skewS ?? 120;
  const audOk = Array.isArray(claims.aud) ? claims.aud.includes(p.audience) : claims.aud === p.audience;
  if (claims.iss !== p.issuer) throw new IntegrationError("IDP_ISSUER_MISMATCH", false);
  if (!audOk) throw new IntegrationError("IDP_AUDIENCE_MISMATCH", false);
  if (typeof claims.exp !== "number" || claims.exp + skew < p.nowUnixSeconds) throw new IntegrationError("IDP_TOKEN_EXPIRED", false);
  if (typeof claims.nbf === "number" && claims.nbf - skew > p.nowUnixSeconds) throw new IntegrationError("IDP_TOKEN_NOT_YET_VALID", false);
  if (claims.nonce !== p.nonce) throw new IntegrationError("IDP_NONCE_MISMATCH", false);
  return claims;
}

/** Grup listesi. Overage (grup sayısı sınırı aşıldı) → null: bu durumda grup eşlemesi GÜNCELLENMEZ. */
export function groupsFromClaims(claims: IdTokenClaims): string[] | null {
  if (claims._claim_names && "groups" in claims._claim_names) return null;
  return Array.isArray(claims.groups) ? claims.groups.filter((g): g is string => typeof g === "string") : [];
}

/** Kullanıcı eşlemesi için e-posta: UPN/preferred_username veya email (küçük harf). */
export function emailFromClaims(claims: IdTokenClaims): string | null {
  const raw = claims.preferred_username ?? claims.email ?? null;
  return raw && raw.includes("@") ? raw.trim().toLowerCase() : null;
}

export async function fetchJwks(cfg: EntraConfig, fetchFn: typeof fetch = fetch): Promise<{ keys: Jwk[] }> {
  let res: Response;
  try {
    res = await fetchFn(`https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/discovery/v2.0/keys`, { signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new IntegrationError("IDP_UNREACHABLE", true);
  }
  if (!res.ok) throw new IntegrationError(`IDP_JWKS_HTTP_${String(res.status)}`, res.status >= 500);
  const body = (await res.json().catch(() => null)) as { keys?: Jwk[] } | null;
  if (!body || !Array.isArray(body.keys)) throw new IntegrationError("IDP_JWKS_INVALID", false);
  return { keys: body.keys };
}
