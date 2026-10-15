// Faz 7: e-imza yapılandırması güvenlik testi (SSRF / taşıma güvenliği). Dış sağlayıcı canlı testi değildir.
import { describe, expect, it } from "vitest";
import { readESignConfig } from "./esignature.js";

describe("e-imza yapılandırması (SSRF ve taşıma güvenliği)", () => {
  it("yapılandırma yoksa null döner (dış çağrı yapılmaz)", () => {
    expect(readESignConfig({})).toBeNull();
  });
  it("düz http taban adresini reddeder", () => {
    expect(() =>
      readESignConfig({ ESIGN_API_BASE_URL: "http://dis.example", ESIGN_API_TOKEN: "t", ESIGN_WEBHOOK_SECRET: "s" }),
    ).toThrow();
  });
  it("https adresini kabul eder, sondaki eğik çizgiyi kırpar, zaman aşımını okur", () => {
    const cfg = readESignConfig({
      ESIGN_API_BASE_URL: "https://esign.example/",
      ESIGN_API_TOKEN: "t",
      ESIGN_WEBHOOK_SECRET: "s",
      ESIGN_TIMEOUT_MS: "5000",
    });
    expect(cfg?.baseUrl).toBe("https://esign.example");
    expect(cfg?.timeoutMs).toBe(5000);
  });
});
