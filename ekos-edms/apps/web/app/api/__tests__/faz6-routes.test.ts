// Faz 6 rota testleri: "yapılandırılmadı" davranışı ve imza/oturum reddi. Bu yollar veritabanına ulaşmadan döner (hızlı, deterministik).
import { afterEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { GET as oidcStart } from "../auth/oidc/start/route";
import { GET as oidcCallback } from "../auth/oidc/callback/route";
import { POST as esignWebhook } from "../webhooks/esignature/route";
import { POST as askRoute } from "../ai/ask/route";

const KEYS = ["AUTH_MODE", "ENTRA_TENANT_ID", "ENTRA_CLIENT_ID", "ENTRA_CLIENT_SECRET", "ENTRA_REDIRECT_URI", "ESIGN_WEBHOOK_SECRET"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of KEYS) saved[k] = process.env[k];

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) Reflect.deleteProperty(process.env, k);
    else process.env[k] = saved[k];
  }
});

describe("OIDC: kimlik bilgisi yoksa 'Yapılandırılmadı' (sahte giriş yok)", () => {
  it("AUTH_MODE=oidc ama ENTRA_* yok → 503 IDP_NOT_CONFIGURED", async () => {
    process.env.AUTH_MODE = "oidc";
    for (const k of KEYS.slice(1, 5)) Reflect.deleteProperty(process.env, k);
    const res = await oidcStart();
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe("IDP_NOT_CONFIGURED");
  });
  it("AUTH_MODE=local iken OIDC başlatma uçları 404 (yan etki yok)", async () => {
    process.env.AUTH_MODE = "local";
    expect((await oidcStart()).status).toBe(404);
    expect((await oidcCallback(new Request("https://ekos.test/api/auth/oidc/callback?code=a&state=b"))).status).toBe(404);
  });
  it("callback: yapılandırma yokken 503 (token uç noktasına istek gitmez)", async () => {
    process.env.AUTH_MODE = "oidc";
    Reflect.deleteProperty(process.env, "ENTRA_TENANT_ID");
    const res = await oidcCallback(new Request("https://ekos.test/api/auth/oidc/callback?code=a&state=b"));
    expect(res.status).toBe(503);
  });
});

describe("e-imza webhook: imza doğrulanmadan işleme yok", () => {
  it("secret yoksa 503 (SERVICE_UNAVAILABLE)", async () => {
    Reflect.deleteProperty(process.env, "ESIGN_WEBHOOK_SECRET");
    const res = await esignWebhook(new Request("https://ekos.test/api/webhooks/esignature", { method: "POST", body: "{}" }));
    expect(res.status).toBe(503);
  });
  it("imza başlığı yok veya yanlış → 401; gövde işlenmez", async () => {
    process.env.ESIGN_WEBHOOK_SECRET = "webhook-test-secret";
    const noSig = await esignWebhook(new Request("https://ekos.test/api/webhooks/esignature", { method: "POST", body: '{"id":"x"}' }));
    expect(noSig.status).toBe(401);
    const body = '{"id":"evt-1","type":"transaction.completed"}';
    const now = Math.floor(Date.now() / 1000);
    const wrong = `t=${String(now)},v1=${"0".repeat(64)}`;
    const bad = await esignWebhook(new Request("https://ekos.test/api/webhooks/esignature", { method: "POST", body, headers: { "x-ekos-signature": wrong } }));
    expect(bad.status).toBe(401);
  });
  it("süresi geçmiş zaman damgası (tekrar oynatma) → 401", async () => {
    process.env.ESIGN_WEBHOOK_SECRET = "webhook-test-secret";
    const body = '{"id":"evt-2"}';
    const old = 1_700_000_000;
    const v1 = createHmac("sha256", "webhook-test-secret").update(`${String(old)}.${body}`).digest("hex");
    const res = await esignWebhook(new Request("https://ekos.test/api/webhooks/esignature", { method: "POST", body, headers: { "x-ekos-signature": `t=${String(old)},v1=${v1}` } }));
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe("TIMESTAMP_OUT_OF_RANGE");
  });
});

describe("RAG API: oturumsuz erişim yok", () => {
  it("oturum çerezi yoksa 401 (AI'ya ve belgelere erişim yok)", async () => {
    process.env.AUTH_MODE = "local";
    const res = await askRoute(
      new Request("https://ekos.test/api/ai/ask", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://ekos.test", Host: "ekos.test" }, body: JSON.stringify({ question: "kira" }) }),
    );
    expect(res.status).toBe(401);
  });
});
