// Faz 5 E2E: giriş, yetki sınırları, dışa aktarma (indirme + reddedilme), erişilebilirlik (axe, WCAG 2.2 AA).
// Ön koşul: geliştirme DB'si + tohum (packages/db/scripts/dev-users.ts) ve çalışan uygulama (E2E_BASE_URL).
import { test, expect, type Page } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";

const PASSWORD = process.env["EKOS_DEV_PASSWORD"] ?? "";

/** Gerçek form girişi (yalnız giriş ekranının kendisini sınayan testlerde kullanılır). */
async function uiLogin(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.goto("/giris");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Parola").fill(password);
  await page.getByRole("button", { name: /giriş/i }).click();
  // Girişin sonucunu bekle: başarılı girişte yönetim alanına yönlenir.
  await page.waitForURL((url) => !url.pathname.startsWith("/giris"), { timeout: 30_000 });
}

/** global-setup'ta açılmış oturumu çereze koyar (giriş uç noktası hız sınırına takılmaz). */
async function login(page: Page, email: string): Promise<void> {
  const sessions = JSON.parse(process.env["EKOS_E2E_SESSIONS"] ?? "{}") as Record<string, string>;
  const value = sessions[email];
  if (!value) throw new Error(`Oturum yok: ${email} (global-setup çalışmadı mı?)`);
  await page.context().addCookies([{ name: "ekos_session", value, url: test.info().project.use.baseURL as string }]);
  await page.goto("/yonetim");
}

test.describe("giriş", () => {
  test("yanlış parola hata gösterir, oturum açılmaz", async ({ page }) => {
    await page.goto("/giris");
    await page.getByLabel("E-posta").fill("onayci@ekos.test");
    await page.getByLabel("Parola").fill("yanlis-parola-deneme-1");
    await page.getByRole("button", { name: /giriş/i }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).not.toHaveURL(/\/yonetim/);
  });

  test("doğru giriş genel bakışa götürür ve oturumu kapatır", async ({ page }) => {
    test.skip(!PASSWORD, "EKOS_DEV_PASSWORD tanımlı değil");
    await uiLogin(page, "onayci@ekos.test");
    await expect(page).toHaveURL(/\/yonetim/);
    await expect(page.getByRole("heading", { name: "Genel Bakış" })).toBeVisible();
    await page.getByRole("button", { name: "Çıkış" }).click();
    await expect(page).toHaveURL(/\/giris/);
  });

  test("oturumsuz yönetim sayfası giriş ekranına yönlendirilir", async ({ page }) => {
    await page.goto("/yonetim/raporlar");
    await expect(page).toHaveURL(/\/giris/);
  });
});

test.describe("yetki sınırları", () => {
  test.skip(!PASSWORD, "EKOS_DEV_PASSWORD tanımlı değil");

  test("kapsamlı denetçi denetim ekranını göremez, raporda denetim türü yoktur", async ({ page }) => {
    await login(page, "denetci@ekos.test");
    await expect(page).toHaveURL(/\/yonetim/);
    await page.goto("/yonetim/denetim");
    await expect(page.getByRole("main").getByRole("alert")).toContainText("yetkiniz yok");
    await page.goto("/yonetim/raporlar");
    const select = page.getByLabel("Rapor türü");
    await expect(select).toBeVisible();
    await expect(select.locator("option", { hasText: "Denetim kayıtları" })).toHaveCount(0);
  });

  test("kullanıcı onay raporunu göremez ve sunucu da reddeder", async ({ page, request }) => {
    await login(page, "kullanici@ekos.test");
    await page.goto("/yonetim/raporlar");
    await expect(page.getByLabel("Rapor türü").locator("option", { hasText: "Açık onay görevleri" })).toHaveCount(0);
    const origin = new URL(page.url()).origin;
    const cookies = await page.context().cookies();
    const res = await request.post("/api/reports/export", {
      headers: { Origin: origin, "Content-Type": "application/json", cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; ") },
      data: { type: "APPROVALS_OPEN", format: "CSV" },
    });
    expect(res.status()).toBe(403);
  });
});

test.describe("yönetim ekranları yetki sınırı", () => {
  test.skip(!PASSWORD, "EKOS_DEV_PASSWORD tanımlı değil");

  test("kullanıcı kurulum ve hatırlatma ayarlarını göremez; kendi bildirim ekranını görür", async ({ page }) => {
    await login(page, "kullanici@ekos.test");
    await page.goto("/yonetim/kurulum");
    await expect(page.getByRole("main").getByRole("alert")).toContainText("yönetici yetkisi");
    await page.goto("/yonetim/hatirlatma");
    await expect(page.getByRole("main").getByRole("alert")).toContainText("yönetici yetkisi");
    await page.goto("/yonetim/bildirimler");
    await expect(page.getByRole("heading", { name: "Bildirimler" })).toBeVisible();
    // page.request oturum çerezlerini paylaşır (ayrı request fixture'ı paylaşmaz).
    const res = await page.request.get("/api/settings");
    expect(res.status()).toBe(403);
  });

  test("yönetici hatırlatma aralığını değiştirir ve sunucu doğrular", async ({ page }) => {
    await login(page, "yonetici@ekos.test");
    await page.goto("/yonetim/hatirlatma");
    const input = page.getByLabel("Gün sayıları (virgülle)");
    await input.fill("abc");
    await page.getByRole("button", { name: "Aralıkları kaydet" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("tam sayı");
    await input.fill("90, 60, 30, 15, 7, 1");
    await page.getByRole("button", { name: "Aralıkları kaydet" }).click();
    await expect(page.getByRole("main").getByRole("status").filter({ hasText: "kaydedildi" })).toBeVisible();
  });
});

test.describe("dışa aktarma", () => {
  test.skip(!PASSWORD, "EKOS_DEV_PASSWORD tanımlı değil");

  test("onaycı açık onay raporunu XLSX olarak indirir", async ({ page }) => {
    await login(page, "onayci@ekos.test");
    await page.goto("/yonetim/raporlar");
    await page.getByLabel("Rapor türü").selectOption("APPROVALS_OPEN");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Raporu indir" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^APPROVALS_OPEN_\d{4}-\d{2}-\d{2}\.xlsx$/);
    await expect(page.getByRole("main").getByText(/Rapor indirildi:/)).toBeVisible();
  });
});

test.describe("erişilebilirlik (axe, WCAG 2.2 AA)", () => {
  const PAGES: { name: string; path: string; who?: string }[] = [
    { name: "giriş", path: "/giris" },
  ];
  for (const p of PAGES) {
    test(`${p.name} sayfasında WCAG 2.2 AA ihlali yok`, async ({ page }) => {
      await page.goto(p.path);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      expect(results.violations).toEqual([]);
    });
  }

  test.describe("oturumlu sayfalar", () => {
    test.skip(!PASSWORD, "EKOS_DEV_PASSWORD tanımlı değil");
    const AUTH_PAGES = ["/yonetim", "/yonetim/sozlesmeler", "/yonetim/gorevler", "/yonetim/raporlar", "/yonetim/bildirimler", "/yonetim/hatirlatma", "/yonetim/kurulum", "/yonetim/belgeler", "/yonetim/yuklemeler", "/yonetim/ice-aktarim"];
    for (const path of AUTH_PAGES) {
      test(`${path} sayfasında WCAG 2.2 AA ihlali yok`, async ({ page }) => {
        await login(page, "yonetici@ekos.test");
        await page.goto(path);
        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
        expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
      });
    }
  });
});
