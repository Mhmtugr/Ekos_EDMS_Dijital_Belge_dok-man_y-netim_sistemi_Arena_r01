// Entegrasyon adaptörü testleri. "Yapılandırılmadı" davranışı, webhook imzası, RS256 kimlik belirteci,
// e-imza bütünlüğü, yeniden deneme politikası ve AI sağlayıcı seçimi. Dış çağrılar test double ile yapılır (mock entegrasyon).
import { createHash, generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { IntegrationError, allConfigured, resolveStatus } from "./types.js";
import { DEFAULT_BACKOFF, nextDelayMs, shouldRetry } from "./retry.js";
import { signWebhookPayload, verifyWebhookSignature } from "./webhook-signature.js";
import { verifyIdToken, groupsFromClaims, emailFromClaims, authorizeUrl, newPkce, readEntraConfig, expectedIssuer, type Jwk } from "./entra.js";
import { GraphMailSender, GraphTokenProvider, readGraphAppConfig } from "./graph.js";
import { parseSignCompletion } from "./esignature.js";
import { NotConfiguredErpConnector } from "./erp.js";
import { createAiProvider, readAiGate } from "./ai/factory.js";
import { MockAiProvider } from "./ai/test-double.js";
import { GeminiProvider } from "./ai/gemini.js";
import { VertexProvider } from "./ai/vertex.js";

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
/** Test double: fetch yerine geçen sahte çağrı (mock entegrasyon). */
const fetchOf = (f: (url: string, init?: RequestInit) => Response): typeof fetch => ((url: string, init?: RequestInit) => Promise.resolve(f(url, init))) as typeof fetch;

describe("yapılandırılmadı davranışı (kimlik bilgisi yok)", () => {
  it("boş ortamda her entegrasyon NOT_CONFIGURED", () => {
    expect(allConfigured({}, ["ENTRA_TENANT_ID"])).toBe(false);
    expect(resolveStatus(false, null)).toBe("NOT_CONFIGURED");
    expect(readEntraConfig({})).toBeNull();
    expect(readGraphAppConfig({ ENTRA_TENANT_ID: "t" })).toBeNull();
  });
  it("boşluktan oluşan değer yapılandırılmış sayılmaz", () => {
    expect(allConfigured({ A: "   " }, ["A"])).toBe(false);
  });
  it("AI varsayılanı NOT_CONFIGURED; anahtar yoksa sağlayıcı oluşturulmaz", () => {
    expect(createAiProvider({}).status).toBe("NOT_CONFIGURED");
    expect(createAiProvider({ AI_PROVIDER: "gemini", AI_MODEL: "m" }).status).toBe("NOT_CONFIGURED");
    expect(createAiProvider({ AI_PROVIDER: "vertex", AI_MODEL: "m", VERTEX_PROJECT: "p" }).status).toBe("NOT_CONFIGURED");
    expect(createAiProvider({ AI_PROVIDER: "bilinmeyen", AI_MODEL: "m" }).status).toBe("NOT_CONFIGURED");
  });
  it("veri işleme onayı yoksa dış AI kapalı kalır (anahtar olsa bile)", () => {
    const env = { AI_PROVIDER: "gemini", AI_MODEL: "m", GEMINI_API_KEY: "k-test" };
    expect(createAiProvider(env).status).toBe("NOT_CONFIGURED");
    expect(createAiProvider({ ...env, AI_DATA_PROCESSING_APPROVED: "true" }).status).toBe("CONFIGURED");
    expect(readAiGate({ AI_APPROVED_DOCUMENT_TYPES: "SOZLESME, bad-code,KIRA" }).approvedTypeCodes).toEqual(["SOZLESME", "KIRA"]);
  });
  it("ERP bağlayıcısı NOT_CONFIGURED döner", async () => {
    await expect(new NotConfiguredErpConnector().listPurchaseOrders()).resolves.toEqual({ status: "NOT_CONFIGURED" });
  });
  it("durum çözümü: yapılandırıldı ama doğrulanmadı ≠ bağlı", () => {
    expect(resolveStatus(true, null)).toBe("CONFIGURED_UNVERIFIED");
    expect(resolveStatus(true, "OK")).toBe("CONNECTED");
    expect(resolveStatus(true, "FAILED")).toBe("FAILED");
  });
  it("e-posta göndericisi kimlik bilgisi yoksa gerçek gönderim yapmaz; alıcısız mesaj FAILED", async () => {
    const tokens = new GraphTokenProvider({ tenantId: "t", clientId: "c", clientSecret: "s" }, fetchOf(() => json({ error: "x" }, 401)));
    const sender = new GraphMailSender(tokens, "bot@ornek.test", fetchOf(() => json({}, 500)));
    const r = await sender.send({ to: null, subject: "s", body: "b", recipientName: "n" });
    expect(r).toEqual({ status: "FAILED", errorCode: "NO_RECIPIENT_ADDRESS", errorMessage: "Alıcı e-posta adresi yok" });
  });
});

describe("webhook imzası", () => {
  const secret = "test-secret-not-real";
  const body = '{"id":"evt-1"}';
  const now = 1_800_000_000;
  it("geçerli imza kabul edilir", () => {
    const header = signWebhookPayload(secret, now, body);
    expect(verifyWebhookSignature({ secret, header, rawBody: body, nowUnixSeconds: now })).toEqual({ ok: true });
  });
  it("gövde değişirse reddedilir", () => {
    const header = signWebhookPayload(secret, now, body);
    expect(verifyWebhookSignature({ secret, header, rawBody: body + " ", nowUnixSeconds: now })).toEqual({ ok: false, code: "SIGNATURE_INVALID" });
  });
  it("eski zaman damgası (tekrar oynatma) reddedilir", () => {
    const header = signWebhookPayload(secret, now, body);
    expect(verifyWebhookSignature({ secret, header, rawBody: body, nowUnixSeconds: now + 3600 })).toEqual({ ok: false, code: "TIMESTAMP_OUT_OF_RANGE" });
  });
  it("başlık yoksa veya bozuksa reddedilir", () => {
    expect(verifyWebhookSignature({ secret, header: null, rawBody: body, nowUnixSeconds: now })).toEqual({ ok: false, code: "SIGNATURE_MISSING" });
    expect(verifyWebhookSignature({ secret, header: "t=1,v1=zz", rawBody: body, nowUnixSeconds: now })).toEqual({ ok: false, code: "SIGNATURE_INVALID" });
  });
});

describe("yeniden deneme politikası", () => {
  it("üstel büyüme ve üst sınır", () => {
    const p = { baseMs: 1000, maxMs: 8000, maxAttempts: 5 };
    expect(nextDelayMs(p, 1, 1)).toBe(1000);
    expect(nextDelayMs(p, 2, 1)).toBe(2000);
    expect(nextDelayMs(p, 10, 1)).toBe(8000);
  });
  it("yalnız yeniden denenebilir hatalar ve maksimum deneme sayısına kadar", () => {
    expect(shouldRetry(DEFAULT_BACKOFF, 1, true)).toBe(true);
    expect(shouldRetry(DEFAULT_BACKOFF, 1, false)).toBe(false);
    expect(shouldRetry(DEFAULT_BACKOFF, DEFAULT_BACKOFF.maxAttempts, true)).toBe(false);
  });
  it("IntegrationError retryable bayrağını taşır", () => {
    expect(new IntegrationError("X", true).retryable).toBe(true);
  });
});

describe("Entra OIDC (RS256, mock IdP anahtarı)", () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...(publicKey.export({ format: "jwk" }) as Record<string, string>), kid: "k1", use: "sig", alg: "RS256" } as Jwk;
  const jwks = { keys: [jwk] };
  const cfg = { tenantId: "tenant-1", clientId: "client-1", clientSecret: "s", redirectUri: "https://ekos.test/cb" };
  const issuer = expectedIssuer(cfg.tenantId);
  const now = 1_800_000_000;
  const make = (claims: Record<string, unknown>, kid = "k1", alg = "RS256"): string => {
    const h = Buffer.from(JSON.stringify({ alg, kid, typ: "JWT" })).toString("base64url");
    const c = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const s = cryptoSign("RSA-SHA256", Buffer.from(`${h}.${c}`), privateKey).toString("base64url");
    return `${h}.${c}.${s}`;
  };
  const base = { iss: issuer, aud: cfg.clientId, exp: now + 600, nbf: now - 10, nonce: "n1", preferred_username: "Yonetici@EKOS.test", groups: ["g-hukuk"] };
  const verify = (t: string, nonce = "n1") => verifyIdToken(t, { jwks, issuer, audience: cfg.clientId, nonce, nowUnixSeconds: now });

  it("geçerli belirteç doğrulanır; e-posta küçük harfe çevrilir", () => {
    const claims = verify(make(base));
    expect(emailFromClaims(claims)).toBe("yonetici@ekos.test");
    expect(groupsFromClaims(claims)).toEqual(["g-hukuk"]);
  });
  it("imza taklidi (farklı anahtar) reddedilir", () => {
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const h = Buffer.from(JSON.stringify({ alg: "RS256", kid: "k1" })).toString("base64url");
    const c = Buffer.from(JSON.stringify(base)).toString("base64url");
    const s = cryptoSign("RSA-SHA256", Buffer.from(`${h}.${c}`), other.privateKey).toString("base64url");
    expect(() => verify(`${h}.${c}.${s}`)).toThrow(/IDP_SIGNATURE_INVALID/);
  });
  it("alg=none ve HS256 reddedilir", () => {
    expect(() => verify(make(base, "k1", "none"))).toThrow(/IDP_TOKEN_ALG/);
    expect(() => verify(make(base, "k1", "HS256"))).toThrow(/IDP_TOKEN_ALG/);
  });
  it("yanlış issuer, audience, süre dolumu ve nonce reddedilir", () => {
    expect(() => verify(make({ ...base, iss: "https://evil.test" }))).toThrow(/IDP_ISSUER_MISMATCH/);
    expect(() => verify(make({ ...base, aud: "baska" }))).toThrow(/IDP_AUDIENCE_MISMATCH/);
    expect(() => verify(make({ ...base, exp: now - 1000 }))).toThrow(/IDP_TOKEN_EXPIRED/);
    expect(() => verify(make(base), "baska-nonce")).toThrow(/IDP_NONCE_MISMATCH/);
  });
  it("bilinmeyen kid reddedilir", () => {
    expect(() => verify(make(base, "yok"))).toThrow(/IDP_KEY_NOT_FOUND/);
  });
  it("grup overage ise grup listesi null (eşleme güncellenmez)", () => {
    expect(groupsFromClaims(verify(make({ ...base, groups: undefined, _claim_names: { groups: "src1" } })))).toBeNull();
  });
  it("PKCE S256 ve yetkilendirme URL'i doğru parametreleri taşır", () => {
    const p = newPkce();
    expect(createHash("sha256").update(p.verifier).digest("base64url")).toBe(p.challenge);
    const u = new URL(authorizeUrl(cfg, p));
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("state")).toBe(p.state);
  });
});

describe("e-imza tamamlanma olayı", () => {
  const file = Buffer.from("%PDF-1.4 imzali");
  const sha = createHash("sha256").update(file).digest("hex");
  const event = (over: Record<string, unknown> = {}) => ({
    id: "evt-9",
    type: "transaction.completed",
    data: {
      transactionId: "tx-1",
      signedAt: "2026-10-10T10:00:00Z",
      parties: [{ name: "Ayşe", email: "AYSE@ornek.test", signedAt: "2026-10-10T09:59:00Z" }],
      document: { base64: file.toString("base64"), sha256: sha },
    },
    ...over,
  });
  it("geçerli olay: işlem kimliği, taraflar, zaman ve dosya çıkarılır", () => {
    const c = parseSignCompletion(event());
    expect(c.transactionId).toBe("tx-1");
    expect(c.parties[0]?.email).toBe("ayse@ornek.test");
    expect(c.signedAt.toISOString()).toBe("2026-10-10T10:00:00.000Z");
    expect(c.signedFileSha256).toBe(sha);
  });
  it("dosya hash'i uyuşmazsa reddedilir (bütünlük)", () => {
    const bad = event();
    (bad.data.document as { sha256: string }).sha256 = "0".repeat(64);
    let code = "";
    try {
      parseSignCompletion(bad);
    } catch (e) {
      code = e instanceof IntegrationError ? e.code : "";
    }
    expect(code).toBe("ESIGN_FILE_HASH_MISMATCH");
  });
  it("tip veya şema yanlışsa reddedilir", () => {
    expect(() => parseSignCompletion(event({ type: "transaction.declined" }))).toThrow(/ESIGN_EVENT_INVALID/);
    expect(() => parseSignCompletion({})).toThrow(/ESIGN_EVENT_INVALID/);
  });
});

describe("AI sağlayıcıları (mock fetch)", () => {
  const body = { candidates: [{ content: { parts: [{ text: '{"fields":[]}' }] } }] };
  it("Gemini: anahtar başlıkta, URL'de değil; JSON yanıt ayrıştırılır", async () => {
    let seenUrl = "";
    let seenHeaders: Record<string, string> = {};
    const f = fetchOf((url, init) => {
      seenUrl = url;
      seenHeaders = (init?.headers ?? {}) as Record<string, string>;
      return json(body);
    });
    const r = await new GeminiProvider("gemini-test", "KEY-TEST", f).generateJson({ system: "s", user: "u" });
    expect(r).toEqual({ ok: true, json: { fields: [] } });
    expect(seenUrl).not.toContain("KEY-TEST");
    expect(seenHeaders["x-goog-api-key"]).toBe("KEY-TEST");
  });
  it("Vertex: bölgesel uç nokta ve bearer belirteci", async () => {
    let seenUrl = "";
    const f = fetchOf((url) => {
      seenUrl = url;
      return json(body);
    });
    const r = await new VertexProvider("m", "proj-1", "europe-west1", "TOKEN", f).generateJson({ system: "s", user: "u" });
    expect(r.ok).toBe(true);
    expect(seenUrl.startsWith("https://europe-west1-aiplatform.googleapis.com/v1/projects/proj-1/locations/europe-west1/")).toBe(true);
  });
  it("HTTP hatası ve bozuk JSON kodlu başarısızlık döner, ham metin sızmaz", async () => {
    const http500 = fetchOf(() => new Response("secret body", { status: 500 }));
    expect(await new GeminiProvider("m", "k", http500).generateJson({ system: "s", user: "u" })).toEqual({ ok: false, code: "AI_HTTP_500" });
    const notJson = fetchOf(() => json({ candidates: [{ content: { parts: [{ text: "not json" }] } }] }));
    expect(await new GeminiProvider("m", "k", notJson).generateJson({ system: "s", user: "u" })).toEqual({ ok: false, code: "AI_NOT_JSON" });
  });
  it("mock sağlayıcı çağrıları kaydeder (mock entegrasyon)", async () => {
    const m = new MockAiProvider(() => ({ ok: true, json: { ok: 1 } }));
    await m.generateJson({ system: "s", user: "u" });
    expect(m.calls).toHaveLength(1);
  });
});
