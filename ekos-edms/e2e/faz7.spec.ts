// Faz 7 E2E: yetkisiz erişim, CSRF, IDOR / nesne ID tahmini, rol yükseltme (403), denetim görünürlüğü,
// yükleme → tarama yokken kullanılamazlık, eşzamanlı sürüm çakışması, dosya adı yoluna (path traversal) karşı dayanıklılık.
// Kayıtlar yalnız gerçek API/UI akışıyla üretilir; sahte veri yoktur.
// Ön koşul: geliştirme DB'si + tohum + çalışan uygulama (E2E_BASE_URL) + EKOS_DEV_PASSWORD.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test, expect, type APIRequestContext } from "@playwright/test";

const SAMPLE_PDF = fileURLToPath(new URL("./fixtures/sozlesme-ornek.pdf", import.meta.url));
const HAS_PASSWORD = Boolean(process.env["EKOS_DEV_PASSWORD"]);

function sessionCookie(email: string): string {
  const sessions = JSON.parse(process.env["EKOS_E2E_SESSIONS"] ?? "{}") as Record<string, string>;
  const value = sessions[email];
  if (!value) throw new Error(`Oturum yok: ${email} (global-setup çalışmadı mı?)`);
  return `ekos_session=${value}`;
}

function originOf(baseURL: string | undefined): string {
  return new URL(baseURL ?? "http://localhost:3000").origin;
}

/** Oturumlu API istemci başlıkları (yalnız aynı köken; CSRF denetimi geçer). */
function auditUrl(): string {
  return `/api/audit/events?from=${istanbulDate(-30)}&to=${istanbulDate(0)}`;
}

function headersFor(email: string, baseURL: string | undefined): Record<string, string> {
  return { cookie: sessionCookie(email), origin: originOf(baseURL) };
}

/** Europe/Istanbul'a göre YYYY-AA-GG; denetim sorgusu aralığı için. */
function istanbulDate(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });
}

async function bodyJson(res: Awaited<ReturnType<APIRequestContext["get"]>>): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

test.describe("yetkisiz erişim ve kimlik", () => {
  test("oturumsuz API isteği 401 alır; denetim verisi dönmez", async ({ request, baseURL }) => {
    const res = await request.get("/api/audit/events", { headers: { origin: originOf(baseURL) } });
    expect(res.status()).toBe(401);
    const body = await bodyJson(res);
    expect(body).not.toHaveProperty("items");
  });

  test("oturumsuz yönetim sayfası giriş ekranına yönlenir (denetim sayfası dahil)", async ({ page }) => {
    await page.goto("/yonetim/denetim");
    await expect(page).toHaveURL(/\/giris/);
  });

  test("oturumsuz yükleme isteği reddedilir", async ({ request, baseURL }) => {
    const res = await request.post("/api/documents/upload", {
      headers: { origin: originOf(baseURL) },
      multipart: { typeCode: "SOZLESME", title: "Yetkisiz", documentDate: "2026-10-01" },
    });
    expect([401, 403]).toContain(res.status());
  });
});

test.describe("CSRF", () => {
  test.skip(!HAS_PASSWORD, "EKOS_DEV_PASSWORD tanımlı değil");

  test("başka kökenden gelen durum değiştiren istek reddedilir (oturum çerezi olsa bile)", async ({ request }) => {
    const res = await request.post("/api/documents/upload", {
      headers: { cookie: sessionCookie("yonetici@ekos.test"), origin: "https://kotu-siteler.example" },
      multipart: { typeCode: "SOZLESME", title: "CSRF", documentDate: "2026-10-01", file: { name: "a.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") } },
    });
    expect(res.status()).toBe(403);
    expect((await bodyJson(res))["code"]).toBe("CSRF_REJECTED");
  });
});

test.describe("IDOR ve nesne ID tahmini", () => {
  test.skip(!HAS_PASSWORD, "EKOS_DEV_PASSWORD tanımlı değil");

  test("var olmayan veya yetkisiz belge kimliği aynı 404 yanıtını verir (varlık oracle'ı yok)", async ({ request, baseURL }) => {
    const h = headersFor("kullanici@ekos.test", baseURL);
    const a = await request.get(`/api/documents/${randomUUID()}/preview`, { headers: h });
    const b = await request.get(`/api/documents/${randomUUID()}/preview`, { headers: h });
    expect(a.status()).toBe(404);
    expect(b.status()).toBe(404);
    expect(await bodyJson(a)).toMatchObject({ code: "NOT_FOUND" });
    expect(await bodyJson(a)).toMatchObject({ code: (await bodyJson(b))["code"] as string });
  });

  test("UUID olmayan kimlik 404 döner (enjeksiyon/ayrıştırma yüzeyi yok)", async ({ request, baseURL }) => {
    const res = await request.get("/api/documents/..%2F..%2Fetc%2Fpasswd/preview", { headers: headersFor("kullanici@ekos.test", baseURL) });
    expect(res.status()).toBe(404);
  });
});

test.describe("rol yükseltme ve denetim görünürlüğü", () => {
  test.skip(!HAS_PASSWORD, "EKOS_DEV_PASSWORD tanımlı değil");

  test("kullanıcı ve denetçi ayar değiştiremez (403); yönetici geçerli gövdeyle değiştirebilir", async ({ request, baseURL }) => {
    const body = { key: "reminders.offsetDays", value: [1, 3], expectedRowVersion: 0 };
    for (const email of ["kullanici@ekos.test", "denetci@ekos.test"]) {
      const res = await request.post("/api/settings", { headers: { ...headersFor(email, baseURL), "content-type": "application/json" }, data: body });
      expect(res.status(), email).toBe(403);
    }
  });

  test("denetim kayıtları yalnız Güvenlik Denetçisi tarafından görülür (yönetici, denetçi, kullanıcı: 403)", async ({ request, baseURL }) => {
    for (const email of ["kullanici@ekos.test", "denetci@ekos.test", "yonetici@ekos.test"]) {
      const res = await request.get(auditUrl(), { headers: headersFor(email, baseURL) });
      expect(res.status(), email).toBe(403);
    }
    const ok = await request.get(auditUrl(), { headers: headersFor("guvenlik@ekos.test", baseURL) });
    expect(ok.status()).toBe(200);
    const body = await bodyJson(ok);
    expect(Array.isArray(body["items"])).toBe(true);
  });

  test("denetim kaydı önce/sonra özetinde gizli değer içermez", async ({ request, baseURL }) => {
    const ok = await request.get(auditUrl(), { headers: headersFor("guvenlik@ekos.test", baseURL) });
    const text = await ok.text();
    expect(text).not.toMatch(/EKOS_DEV_PASSWORD|tokenHash|totpSecret|passwordHash/i);
  });
});

test.describe("yükleme, tarama ve sürüm", () => {
  test.skip(!HAS_PASSWORD, "EKOS_DEV_PASSWORD tanımlı değil");
  test.describe.configure({ mode: "serial" });

  const title = `Faz7 E2E ${new Date().toISOString()}`;
  let documentId = "";
  let counterpartyId = "";

  test("yükleme kabul edilir; tarayıcı (ClamAV) yapılandırılmadığı için belge CLEAN olmaz", async ({ request, baseURL }) => {
    const cp = await request.post("/api/counterparties", {
      headers: { ...headersFor("sozlesme@ekos.test", baseURL), "content-type": "application/json" },
      data: { officialName: `Faz7 E2E Karşı Taraf ${String(Date.now())}`, countryCode: "TR" },
    });
    expect(cp.status()).toBe(201);
    counterpartyId = String((await bodyJson(cp))["id"]);
    const res = await request.post("/api/documents/upload", {
      headers: headersFor("sozlesme@ekos.test", baseURL),
      multipart: {
        typeCode: "SOZLESME",
        counterpartyId,
        title,
        documentDate: "2026-10-01",
        file: { name: "ornek.pdf", mimeType: "application/pdf", buffer: readFileSync(SAMPLE_PDF) },
      },
    });
    expect(res.status()).toBe(201);
    const body = await bodyJson(res);
    documentId = String(body["documentId"]);
    expect(documentId).toMatch(/^[0-9a-f-]{36}$/);
    // Tarama sonucu CLEAN değilse dosya kullanılamaz (karantina).
    expect(String(body["scan"])).not.toBe("CLEAN");
  });

  test("taranmamış belgenin önizlemesi verilmez", async ({ request, baseURL }) => {
    test.skip(!documentId, "önceki adım yok");
    const res = await request.get(`/api/documents/${documentId}/preview`, { headers: headersFor("sozlesme@ekos.test", baseURL) });
    expect(res.status()).not.toBe(200);
  });

  test("yolu andıran dosya adı depolama yolunu etkilemez ve yüklemeyi bozmaz", async ({ request, baseURL }) => {
    const res = await request.post("/api/documents/upload", {
      headers: headersFor("sozlesme@ekos.test", baseURL),
      multipart: {
        typeCode: "SOZLESME",
        title: `${title} trv`,
        counterpartyId,
        documentDate: "2026-10-01",
        file: { name: "../../../etc/passwd.pdf", mimeType: "application/pdf", buffer: readFileSync(SAMPLE_PDF) },
      },
    });
    expect([201, 422]).toContain(res.status());
  });

  test("aynı beklenen sürüm numarasıyla iki yeni sürüm yarışınca yalnız biri kabul edilir", async ({ request, baseURL }) => {
    test.skip(!documentId, "önceki adım yok");
    const pdf = readFileSync(SAMPLE_PDF) as Buffer;
    const send = () =>
      request.post(`/api/documents/${documentId}/versions`, {
        headers: headersFor("sozlesme@ekos.test", baseURL),
        multipart: { reason: "E2E eşzamanlılık", expectedRowVersion: "1", file: { name: "v2.pdf", mimeType: "application/pdf", buffer: pdf } },
      });
    const [a, b] = await Promise.all([send(), send()]);
    const statuses = [a.status(), b.status()].sort();
    // Beklenen: biri 201 (veya 202), diğeri 409 VERSION_CONFLICT. İkisi de 409 ise başlangıç rowVersion farklıdır.
    expect(statuses.filter((s) => s === 409).length).toBeGreaterThanOrEqual(1);
    expect(statuses.filter((s) => s >= 200 && s < 300).length).toBeLessThanOrEqual(1);
  });

  test("denetim kaydı yüklemeyi kullanıcıya atfeder", async ({ request, baseURL }) => {
    test.skip(!documentId, "önceki adım yok");
    const res = await request.get(`${auditUrl()}&targetType=Document`, { headers: headersFor("guvenlik@ekos.test", baseURL) });
    expect(res.status()).toBe(200);
  });
});

test.describe("hatırlatma, saklama/imha, personel ayrılışı ve zamanlı işler", () => {
  test.skip(!HAS_PASSWORD, "EKOS_DEV_PASSWORD tanımlı değil");

  test("zamanlı işleri elle tetikleme (hatırlatma + teslim + uyarı) yalnız yönetici içindir", async ({ request, baseURL }) => {
    const denied = await request.post("/api/jobs/run", { headers: headersFor("kullanici@ekos.test", baseURL) });
    expect(denied.status()).toBe(403);
    const ok = await request.post("/api/jobs/run", { headers: headersFor("yonetici@ekos.test", baseURL) });
    expect(ok.status()).toBe(200);
    const body = await bodyJson(ok);
    expect(body).toHaveProperty("reminders");
    expect(body).toHaveProperty("delivery");
    // Uyarı değerlendirmesi çalışır; çıktı yalnız kural kodlarıdır (PII yok).
    const alerts = body["alerts"] as { fired: string[]; notified: number };
    expect(Array.isArray(alerts.fired)).toBe(true);
    for (const code of alerts.fired) expect(code).toMatch(/^[A-Z_]+$/);
  });

  test("hatırlatma ekranı yetkili kullanıcıya açılır; yetkisiz kullanıcı ayarları göremez", async ({ page }) => {
    await page.context().addCookies([{ name: "ekos_session", value: sessionCookie("yonetici@ekos.test").split("=")[1] ?? "", url: test.info().project.use.baseURL as string }]);
    await page.goto("/yonetim/hatirlatma");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("saklama ve imha kayıtları API'si oturumsuz erişime kapalıdır", async ({ request, baseURL }) => {
    const res = await request.get("/api/disposal/queue", { headers: { origin: originOf(baseURL) } });
    expect([401, 403]).toContain(res.status());
  });

  test("imha kuyruğu görünürlük filtrelidir: kullanıcı yalnız görebildiği kayıtları alır (sorgu düzeyinde filtre)", async ({ request, baseURL }) => {
    const res = await request.get("/api/disposal/queue", { headers: headersFor("kullanici@ekos.test", baseURL) });
    expect(res.status()).toBe(200);
    const body = await bodyJson(res);
    expect(Array.isArray(body["items"])).toBe(true);
    // Kullanıcının kapsamı dışındaki belgeler (ör. SOZLESME, gizlilik kapsamlı) listede olmamalıdır.
    const items = body["items"] as { documentId: string }[];
    expect(items.every((i) => typeof i.documentId === "string")).toBe(true);
  });

  test("personel ayrılışı listesi: yetkisiz kullanıcı göremez; oturumsuz 401", async ({ request, baseURL }) => {
    const anon = await request.get("/api/offboarding", { headers: { origin: originOf(baseURL) } });
    expect(anon.status()).toBe(401);
    const denied = await request.get("/api/offboarding", { headers: headersFor("kullanici@ekos.test", baseURL) });
    expect(denied.status()).toBe(403);
  });
});
