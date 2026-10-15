// Faz 5 E2E: sözleşme uçtan uca (oluşturma → alan girişi → onay başlatma → onaycı kararı → imza kanıtı → yürürlük).
// Kayıtlar yalnız gerçek UI/API akışıyla üretilir; sahte veri yoktur. Ön koşul: global-setup oturumları + yayımlı onay matrisi.
import { test, expect, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

const SAMPLE_PDF = fileURLToPath(new URL("./fixtures/sozlesme-ornek.pdf", import.meta.url));

async function login(page: Page, email: string): Promise<void> {
  const sessions = JSON.parse(process.env["EKOS_E2E_SESSIONS"] ?? "{}") as Record<string, string>;
  const value = sessions[email];
  if (!value) throw new Error(`Oturum yok: ${email} (global-setup çalışmadı mı?)`);
  await page.context().addCookies([{ name: "ekos_session", value, url: test.info().project.use.baseURL as string }]);
  await page.goto("/yonetim");
}

test.describe.configure({ mode: "serial" });

test.describe("sözleşme akışı (uçtan uca)", () => {
  test.skip(!process.env["EKOS_DEV_PASSWORD"], "EKOS_DEV_PASSWORD tanımlı değil");

  const title = `E2E Sözleşme ${new Date().toISOString().slice(11, 19).replace(/:/g, "")}`;
  let contractUrl = "";

  test("yetkisiz kullanıcı yeni sözleşme ekranında form göremez", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, "denetci@ekos.test");
    await page.goto("/yonetim/sozlesmeler/yeni");
    await expect(page.getByText("Sözleşme oluşturmak için yetkiniz yok.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Taslak sözleşme oluştur" })).toHaveCount(0);
    await ctx.close();
  });

  test("sözleşme yöneticisi taslak oluşturur", async ({ page }) => {
    await login(page, "sozlesme@ekos.test");
    await page.goto("/yonetim/sozlesmeler/yeni");
    await page.getByLabel("Başlık").fill(title);
    await page.getByLabel(/Karşı taraf/).selectOption({ label: "Örnek Tedarikçi Ltd. Şti. (TR)" });
    await page.getByLabel(/Birim/).selectOption({ label: "Hukuk" });
    await page.getByLabel("Belge tarihi").fill("2026-10-01");
    await page.locator('input[name="file"]').setInputFiles(SAMPLE_PDF);
    await page.getByRole("button", { name: "Dosyalı taslak sözleşme oluştur" }).click();
    // Tarama yapılandırılmamışsa sonuç açıkça bildirilir (sahte "temiz" yok).
    await page.waitForURL(/\/yonetim\/sozlesmeler\/[0-9a-f-]{36}(\?tarama=[A-Z_]+)?$/, { timeout: 30_000 });
    contractUrl = page.url().split("?")[0] ?? "";
    await expect(page.getByText("Sözleşme dosyası yüklendi; tarama durumu:")).toBeVisible();
    await expect(page.locator("main").getByText(/Tarama (servisi kullanılamıyor|yapılandırılmadı|hatası|bekleniyor)|Bulaşma/)).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(title);
    await expect(page.getByText("Durum:")).toContainText("DRAFT");
  });

  test("alanlar girilir; sürüm çakışması yoktur ve kayıt görünür", async ({ page }) => {
    await login(page, "sozlesme@ekos.test");
    await page.goto(contractUrl);
    await page.getByLabel("Başlangıç tarihi").fill("2026-11-01");
    await page.getByLabel("Bitiş tarihi").fill("2027-10-31");
    await page.getByLabel("İhbar süresi (sayı)").fill("30");
    await page.getByLabel("İhbar birimi").selectOption("CALENDAR_DAYS");
    await page.getByLabel("Tutar").fill("15000.00");
    await page.getByLabel("Para birimi (ISO 4217)").fill("TRY");
    await page.getByRole("button", { name: "Alanları kaydet" }).click();
    await expect(page.getByRole("status").last()).toContainText("kaydedildi");
    await page.reload();
    await expect(page.getByLabel("Bitiş tarihi")).toHaveValue("2027-10-31");
  });

  test("bitiş tarihi başlangıçtan önce ise kayıt reddedilir", async ({ page }) => {
    await login(page, "sozlesme@ekos.test");
    await page.goto(contractUrl);
    await page.getByLabel("Bitiş tarihi").fill("2026-01-01");
    await page.getByRole("button", { name: "Alanları kaydet" }).click();
    await expect(page.getByText("olamaz", { exact: false })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Bitiş tarihi")).toHaveValue("2027-10-31");
  });

  test("onay akışı başlatılır ve onaycı görevi onaylar", async ({ page, browser }) => {
    await login(page, "sozlesme@ekos.test");
    await page.goto(contractUrl);
    await page.getByRole("button", { name: "Onay akışını başlat" }).click();
    await expect(page.getByRole("status").last()).toContainText("başlatıldı");

    const ctx = await browser.newContext();
    const approver = await ctx.newPage();
    await login(approver, "onayci@ekos.test");
    await approver.goto("/yonetim/gorevler");
    await expect(approver.getByRole("button", { name: `${title} görevini onayla` })).toBeVisible();
    await approver.getByRole("button", { name: `${title} görevini onayla` }).click();
    await expect(approver.getByRole("status").last()).toContainText("Karar kaydedildi");
    await ctx.close();
  });

  test("taranmamış sözleşme dosyası imzalanamaz; açık hata gösterilir ve sözleşme yürürlüğe girmez", async ({ page }) => {
    await login(page, "sozlesme@ekos.test");
    await page.goto(contractUrl);
    await expect(page.getByText("Durum:")).toContainText("READY_FOR_SIGNATURE");
    await page.getByLabel("İmza tarihi").fill("2026-10-10");
    await page.getByLabel("İmza yöntemi").fill("Islak imza (taranmış kopya)");
    await page.getByLabel("İmzacı(lar)").fill("Örnek Yetkili, Örnek Tedarikçi");
    await page.getByRole("button", { name: "İmza kanıtını kaydet" }).click();
    await expect(page.locator("form").getByRole("alert")).toContainText("taramadan");
    await page.reload();
    await expect(page.getByText("Durum:")).toContainText("READY_FOR_SIGNATURE");
  });
});
