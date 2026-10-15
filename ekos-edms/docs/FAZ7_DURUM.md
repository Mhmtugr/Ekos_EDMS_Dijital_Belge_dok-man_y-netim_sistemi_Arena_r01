# Faz 7 — Durum Raporu (agent çalıştırması)

Tarih: 2026-10-15 (Europe/Istanbul). Ortam: Node v20.20.2, pnpm 9.12.0 (`npx --yes pnpm@9.12.0`), gömülü PostgreSQL 16 (geliştirme ortamı), Chromium (Playwright).

> **Bu rapor `DOĞRULANDI` değildir.** Aşağıdaki sonuçlar agent'ın bu sandbox'ta çalıştırdığı komutların gerçek çıktılarıdır. Kullanıcı kendi ortamında çalıştırıp sonucu bildirene kadar her satır "agent çalıştırdı" durumundadır.

## 1. Son tur komut sonuçları

| Kontrol | Komut | Sonuç |
|---|---|---|
| Tip denetimi | `pnpm typecheck` (kök + paketler + apps) | **exit 0** |
| Lint (tüm repo) | `node scripts/lint.mjs` | **exit 0**, `--max-warnings=0` (tek `eslint .` süreci bellek sınırında çöküyor; betik paket bazında koşuyor) |
| Birim/entegrasyon | `npx vitest run` | **50 dosya, 537/537 geçti, 0 atlanan** |
| Bağımlılık açıkları | `pnpm audit` ve `pnpm audit --prod` | **No known vulnerabilities found** |
| Üretim derlemesi | `next build --no-lint` (apps/web) | **exit 0**; `/api/health`, `/api/jobs/run`, `/giris` rotaları derlendi |
| Uçtan uca | `EKOS_DEV_PASSWORD=… E2E_BASE_URL=http://localhost:3000 npx playwright test` | **50/50 geçti, 0 atlanan** (yeni derlemeye karşı) |
| SAST (Semgrep `p/dockerfile`, `docker/`) | `semgrep --config p/dockerfile docker/` | **0 bulgu** (önceki 2 "root kullanıcı" bulgusu giderildi) |
| Worker bağımlılık paketi | `pnpm --filter @ekos/worker deploy --prod` + yerel başlatma | **Çalıştı**; SIGTERM ile düzgün durdu (düzeltme sonrası) |
| Standalone web çalışma zamanı | `node apps/web/server.js` (Dockerfile ile aynı dosya düzeni) | `/giris` 200; `/api/health` 200 (`database: ok`, `storage: ok`) |

Son E2E koşusunun ilk iki denemesinde (`/tmp` günlükleri) 38 test atlandı ve 4'ü başarısız oldu. Kök neden: **`EKOS_DEV_PASSWORD` ortamda tanımlı değildi**; `e2e/global-setup.ts` bu durumda sessizce çıkıyor ve oturumlar kurulmuyordu. Hız sınırı nedeni değildi (ilk teşhisim yanlıştı). Parola yalnızca Playwright sürecine, değeri yazdırılmadan aktarıldıktan sonra paket 50/50 geçti.

## 2. Bu turda yapılan değişiklikler

- **Dockerfile'lar yeniden yazıldı** (`docker/web.Dockerfile`, `docker/worker.Dockerfile`): çok aşamalı; çalışma zamanı kullanıcısı `ekos` (root değil); yalnız standalone çıktı / derlenmiş bağımlılıklar taşınır. Worker imajına `tesseract-ocr` ve Türkçe veri paketi eklendi. **Paket adı `tesseract-ocr-data-tur` Alpine deposunda doğrulanmadı.** Worker derlemesi, deploy çıktısına derlenmiş Prisma istemcisini kopyalar ve istemci başlatılmamışsa derlemeyi başarısız kılar (yerelde doğrulandı).
- **Web standalone Prisma motoru düzeltildi** (`apps/web/next.config.mjs`, `outputFileTracingIncludes`): standalone çıktısında `libquery_engine` yoktu; veritabanı çağrıları imajda başarısız olacaktı. Yerelde standalone sunucu üzerinde doğrulandı.
- **Sağlık uç noktası gerçek kontrole çevrildi** (`apps/web/app/api/health/route.ts`): iskelet (`"skeleton"`) kaldırıldı. Veritabanı `SELECT 1`, depolama yazılabilirliği denetlenir; kritik hata → 503. Antivirüs ve OCR için yalnız yapılandırma durumu bildirilir (`NOT_CONFIGURED` / `CONFIGURED_NOT_PROBED`); canlı yoklama yapılmaz. Yanıtta sır/yol yoktur.
- **Docker Compose yeniden yazıldı** (`docker/docker-compose.yml`): Redis ve MinIO kaldırıldı (kullanılmıyordu); PostgreSQL, ClamAV, web, worker; web ve worker aynı `STORAGE_ROOT` birimini paylaşır; `no-new-privileges`, `cap_drop: ALL`; tüm portlar `127.0.0.1`. **Compose `docker compose config` ile doğrulanmadı (Docker yok); yalnız YAML ayrıştırması ve port kuralı denetlendi.**
- **Worker bağımlılığı:** `tsx`, `devDependencies`'ten `dependencies`'e taşındı (kaynak TS olarak çalışan worker için gerekli).
- **`.dockerignore`:** `data/`, `e2e/`, `docs/`, `.pgdata`, raporlar, loglar ve `.env*` (yalnız `.env.example` hariç) eklendi.
- **Lint düzeltmesi:** `e2e/faz7.spec.ts` şablon dizgisi (`String(Date.now())`).

## 3. Kapsam matrisi (özet)

| Alan | Durum | Kanıt |
|---|---|---|
| XSS (statik API denetimi) | Agent çalıştırdı: geçti | `packages/db/src/security/security.test.ts` |
| Path traversal / dosya yükleme / sahte dosya | Agent çalıştırdı: geçti (birim + E2E) | security.test.ts; `e2e/faz7.spec.ts` |
| SQLi (arama parametreleri) | Agent çalıştırdı: geçti | security.test.ts |
| CSRF (durum değiştiren uçlar) | Agent çalıştırdı: E2E geçti | `e2e/faz7.spec.ts` (başka köken → 403) |
| IDOR / nesne ID tahmini (aynı 404, UUID dışı 404) | Agent çalıştırdı: E2E geçti | `e2e/faz7.spec.ts` |
| Rol yükseltme / ayrıcalıklı kullanıcı / denetim görünürlüğü | Agent çalıştırdı: E2E geçti | `e2e/faz7.spec.ts` |
| SSRF | Kısmi: e-imza HTTPS zorunlu (birim); dinamik fetch denetimi statik | esignature-config.test.ts |
| İndirme URL süresi | Kalıcı/imzalı URL üretilmiyor (statik denetim) | security.test.ts |
| Arama/rapor sızıntısı | Agent çalıştırdı: geçti | security.test.ts |
| Log hijyeni | Agent çalıştırdı: geçti (statik) | security.test.ts |
| `pnpm audit` | Temiz | §1 |
| SAST | Özel statik testler + Semgrep Dockerfile kuralları (0 bulgu). Tam Semgrep (110 kural) önceki turda çalıştı, bu turda yeniden koşulmadı | — |
| Yükleme → tarama → OCR → arama; sürümleme; eşzamanlı çelişki | Agent çalıştırdı: E2E ve birim testleri geçti. ClamAV yapılandırılmadığı için belge CLEAN olmaz (kasıtlı) | `e2e/faz7.spec.ts`, concurrency.test.ts |
| Sözleşme onay + e-imza kanıtı | Agent çalıştırdı: E2E geçti; e-imza sağlayıcısı **mock** | `e2e/sozlesme-akisi.spec.ts`, esign-version.test.ts |
| Hatırlatma, saklama/hold/imha, personel ayrılışı, zamanlı işler | Agent çalıştırdı: E2E geçti | `e2e/faz7.spec.ts` |
| İmha kuyruğu | Görünürlük filtreli 200 (tasarım gereği; yetkisiz kullanıcı 403 değil) | faz7.spec.ts |
| Uyarılar | Eşik hesabı + `SECURITY_ALERT` olarak GD'ye yazım (in-app). E-posta/Teams **NOT_CONFIGURED** | alerts.test.ts |
| Yedek / geri yükleme | Modül testleri gerçek PostgreSQL'de geçti; üretim-benzeri dizinde uçtan uca çalıştırılmadı | backup.test.ts |
| Üretim yapılandırma doğrulaması; güvenli başlatma reddi | Birim testleri geçti; geliştirme parolası üretimde reddedilir | runtime-config.test.ts |
| Migration veri silme yasağı | Statik denetim geçti | security.test.ts |
| Sahte veri taraması (build) | Agent çalıştırdı: geçti | security.test.ts |
| Sağlık uç noktası | Gerçek DB/depolama kontrolü; 200/503 | §2 |
| Container imajları | Dockerfile'lar yazıldı; **imaj derlenmedi** (Docker yok) | §2 |

## 4. Açık kalan işler (dürüst liste)

1. **Docker imajları ve compose:** `docker build` ve `docker compose config` bu ortamda çalıştırılamadı. Alpine paket adları (özellikle `tesseract-ocr-data-tur`) doğrulanmadı.
2. **E2E kurulum sessiz atlama:** `EKOS_DEV_PASSWORD` yokken `global-setup` sessizce çıkar ve testler atlanır. Bu, CI'da yanlış yeşil değil ama kırmızı gürültü üretir. Önerilen düzeltme: parola yoksa açık hata (henüz yapılmadı).
3. **Giriş hız sınırı:** IP başına 15 dakikada 30 deneme, bellek içi. Art arda E2E koşuları bu sınırı tüketebilir; sunucu yeniden başlatılınca sıfırlanır (bu bir güvenlik kontrolünü atlatma değildir). Çok sunuculu dağıtımda bu sınır paylaşılmaz; dağıtım notu gerekir.
4. **Dış sağlayıcılar:** e-imza, SMTP, ClamAV, OIDC, OCR canlı testleri yapılamadı (kimlik bilgisi/sunucu yok). Hepsi **mock/NOT_CONFIGURED** olarak etiketlidir.
5. **A5/5 varsayımı:** hukuk onayı bekliyor; kod bu varsayıma göre yazıldı.
6. **Go-live onayları (alınamaz):** hukuk, mali işler, İK ve veri koruma onayları **alınmamıştır**. Bu onaylar olmadan üretime geçilmemelidir.
7. **RPO/RTO:** şirketçe onaylanmış değer yoktur; **hiçbir RPO/RTO sözü verilmemiştir**.
8. **Yedekleme CLI'ı** üretim-benzeri bir dizinde uçtan uca çalıştırılmadı.
9. **Kullanıcı rehberi, rol-izin matrisinin tam güncellemesi, API/adaptör durum tablosunun tamamı:** kısmi (`docs/OPERASYON.md`, `docs/PERMISSIONS.md`). Eksik kalan bölümler bu tablodadır.
10. **Tam kapı yeniden koşusu:** tip denetimi, lint, vitest, audit ve E2E bu turda temiz koşuldu; tam Semgrep (110 kural) bu turda yeniden koşulmadı.
11. **Geçici veritabanı:** `ekos_restore_drill` (geliştirme PostgreSQL'i) tatbikat sonrası kaldı; silinmedi.

## 5. Uygulamayı çalıştırma (son hal)

Web, Next standalone çıktısıyla çalışır (`next start` standalone yapılandırmada uyarı verir ve kullanılmaz):

```bash
cd apps/web && node_modules/.bin/next build --no-lint
mkdir -p .next/standalone/apps/web/.next && cp -r .next/static .next/standalone/apps/web/.next/static
cd .next/standalone && HOSTNAME=0.0.0.0 PORT=3000 node apps/web/server.js   # DATABASE_URL, STORAGE_ROOT, AUTH_MODE, TOTP_ENCRYPTION_KEY gerekir
```

Doğrulama: `GET /api/health` → `{"status":"ok","checks":{"database":"ok","storage":"ok",...}}`.

Kullanıcının çalıştırması gereken komutlar (DOĞRULANDI için):

```bash
npx --yes pnpm@9.12.0 install --frozen-lockfile
npx --yes pnpm@9.12.0 --filter @ekos/db prisma:generate
npx --yes pnpm@9.12.0 typecheck
node scripts/lint.mjs
npx vitest run                         # beklenen: 50 dosya, 537 test
npx --yes pnpm@9.12.0 audit            # beklenen: No known vulnerabilities found
EKOS_DEV_PASSWORD=… E2E_BASE_URL=http://localhost:3000 npx playwright test   # beklenen: 50/50
```

Kullanıcı bu komutları çalıştırıp sonucu bildirene kadar hiçbir satır `DOĞRULANDI` değildir.
