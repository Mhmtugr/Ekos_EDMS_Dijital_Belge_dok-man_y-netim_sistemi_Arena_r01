// Faz 6 E2E: entegrasyon "Yapılandırılmadı" görünürlüğü, belge sorgu (RAG) ekranı, imzasız webhook reddi, erişilebilirlik (axe).
// Ön koşul: geliştirme DB'si + tohum, çalışan uygulama (E2E_BASE_URL). Dış entegrasyon ortam değişkenleri TANIMSIZ olmalıdır.
import { test, expect, type Page } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";

function sessionFor(email: string): string {
  const sessions = JSON.parse(process.env["EKOS_E2E_SESSIONS"] ?? "{}") as Record<string, string>;
  const value = sessions[email];
  if (!value) throw new Error(`Oturum yok: ${email} (global-setup çalışmadı mı?)`);
  return value;
}

async function login(page: Page, email: string): Promise<void> {
  await page.context().addCookies([{ name: "ekos_session", value: sessionFor(email), url: test.info().project.use.baseURL as string }]);
  await page.goto("/yonetim");
}

test.describe("entegrasyonlar ekranı", () => {
  test("yapılandırılmamış dış sistemler 'Yapılandırılmadı' gösterir; sahte 'Bağlı' yoktur", async ({ page }) => {
    await login(page, "yonetici@ekos.test");
    await page.goto("/yonetim/entegrasyonlar");
    await expect(page.getByRole("heading", { name: "Entegrasyonlar" })).toBeVisible();
    const oidcRow = page.getByRole("row").filter({ hasText: "Entra ID" });
    await expect(oidcRow).toContainText("Yapılandırılmadı");
    await expect(oidcRow).not.toContainText("Bağlı");
    const esignRow = page.getByRole("row").filter({ hasText: "E-imza" });
    await expect(esignRow).toContainText("Yapılandırılmadı");
  });

  test("entegrasyonlar ekranı WCAG 2.2 AA ihlali içermez", async ({ page }) => {
    await login(page, "yonetici@ekos.test");
    await page.goto("/yonetim/entegrasyonlar");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});

test.describe("belge sorgu (RAG) ekranı", () => {
  test("eşleşen belge yoksa 'Belgede doğrulanabilir bilgi bulunamadı.' döner (uydurma yanıt yok)", async ({ page }) => {
    await login(page, "kullanici@ekos.test");
    await page.goto("/yonetim/sor");
    await page.getByLabel("Soru").fill("zzqxv tanımsız terim");
    await page.getByRole("button", { name: "Sor" }).click();
    await expect(page.getByText("Belgede doğrulanabilir bilgi bulunamadı.")).toBeVisible();
  });

  test("sorgu ekranı WCAG 2.2 AA ihlali içermez", async ({ page }) => {
    await login(page, "kullanici@ekos.test");
    await page.goto("/yonetim/sor");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });

  test("oturumsuz API erişimi reddedilir", async ({ request }) => {
    const res = await request.post("/api/ai/ask", { headers: { "Content-Type": "application/json" }, data: { question: "kira" } });
    expect([401, 403]).toContain(res.status());
  });
});

test.describe("e-imza webhook'u", () => {
  test("imzasız istek işlenmez; yapılandırma yoksa 503", async ({ request }) => {
    const res = await request.post("/api/webhooks/esignature", { headers: { "Content-Type": "application/json" }, data: { id: "evt-e2e-1", type: "transaction.completed" } });
    expect([401, 503]).toContain(res.status());
  });
});
