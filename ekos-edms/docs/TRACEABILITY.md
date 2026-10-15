# Gereksinim İzlenebilirlik Matrisi

Durum sözlüğü (bu sözlük dışında durum kullanılmaz):

- `PLANLANDI` — gereksinim tanımlandı, kod yok.
- `KODLANDI` — kod ve test yazıldı, kullanıcı tarafında çalıştırılmadı.
- `DOĞRULANDI` — kullanıcı testleri kendi ortamında çalıştırdı ve sonucunu bildirdi.

`DOĞRULANDI` yalnızca kullanıcı bildirimi ile işaretlenir. Faz 0a/0b sonunda kodlanan satırlar `KODLANDI` olarak işaretlenmiştir; hiçbiri kullanıcı tarafından `DOĞRULANDI` değildir.

| ID          | Gereksinim                                                                           | Kaynak             | Uygulama (kod/ekran/kural)           | Test                                                                | Durum     |
| ----------- | ------------------------------------------------------------------------------------ | ------------------ | ------------------------------------ | ------------------------------------------------------------------- | --------- |
| R-ARC-01    | Modüler monolit; mikroservis yok                                                     | A4                 | ARCHITECTURE §2                      | —                                                                   | KODLANDI  |
| R-ARC-02    | İş kuralları yalnızca `packages/core`'da; UI karar vermez                            | A4                 | `packages/core`                      | Faz 1 lint kuralı                                                   | PLANLANDI |
| R-ARC-03    | Bağımlılık yönü (core ← adapters ← apps)                                             | ARCHITECTURE §2.1  | `no-restricted-imports`              | Faz 1                                                               | PLANLANDI |
| R-ID-01     | Iç kimlik UUIDv7 değişmez                                                            | A4                 | Prisma şeması                        | schema.test.ts (UUIDv7 kuralı)                                      | KODLANDI  |
| R-ID-02     | Numara `EKOS-{TÜRKODU}-{YIL}-{6}` çakışmasız                                         | A4                 | Sayaç tablosu                        | Faz 0b/1 eşzamanlılık testi                                         | PLANLANDI |
| R-TIME-01   | Zaman UTC `timestamptz`; sözleşme tarihi `DATE`                                      | A4                 | Prisma `@db.Date`                    | schema.test.ts (sözleşme tarihleri @db.Date)                        | KODLANDI  |
| R-MONEY-01  | Para `NUMERIC(19,4)` + ISO 4217; float yok                                           | A4                 | Prisma + `decimal.js`                | schema.test.ts (float yok) + migrations.test.ts (para birimi CHECK) | KODLANDI  |
| R-CC-01     | `rowVersion` + 409                                                                   | A4                 | API katmanı                          | Faz 2 eşzamanlılık                                                  | PLANLANDI |
| R-CC-02     | Kritik POST `Idempotency-Key`                                                        | A4                 | API katmanı                          | Faz 1/2                                                             | PLANLANDI |
| R-DEL-01    | Fiziksel silme yok (`onDelete: Restrict`)                                            | A4                 | Prisma şeması                        | schema.test.ts + migrations.test.ts (RESTRICT)                      | KODLANDI  |
| R-AUTH-01   | `AUTH_MODE` açık seçim; oidc'de yerel parola yok                                     | A4                 | Kimlik modülü                        | Faz 1                                                               | PLANLANDI |
| R-AUTH-02   | Yerel mod: argon2id, kilit, rate limit, TOTP                                         | A4                 | Kimlik modülü                        | Faz 1                                                               | PLANLANDI |
| R-AUTH-03   | İlk yönetici tek kullanımlık CLI belirteci                                           | A4                 | CLI                                  | Faz 1                                                               | PLANLANDI |
| R-AUTHZ-01  | `authorize()` tek merkez; deny-by-default                                            | A4                 | `packages/core` yetki                | Faz 1 birim testleri                                                | PLANLANDI |
| R-AUTHZ-02  | DENY önceliği; kapsam kesişimi                                                       | A4                 | `packages/core` yetki                | Faz 1                                                               | PLANLANDI |
| R-AUTHZ-03  | 404 (görünmez) / 403 (eylem yok) ayrımı                                              | A4                 | API                                  | Faz 1/2 IDOR testi                                                  | PLANLANDI |
| R-AUTHZ-04  | Platform Yöneticisi içerik izni yok                                                  | A4, PERMISSIONS §4 | Rol şablonu                          | Faz 1 birim testi                                                   | PLANLANDI |
| R-AUTHZ-05  | Güvenlik denetçisi içerik izni yok                                                   | A4, PERMISSIONS §4 | Rol şablonu                          | Faz 1 birim testi                                                   | PLANLANDI |
| R-AUTHZ-06  | Liste/arama sayımı yetki filtresinden sonra                                          | A4                 | Arama/liste sorgusu                  | Faz 2                                                               | PLANLANDI |
| R-BG-01     | Break-glass: gerekçe, süre, ikinci onay, görünür audit                               | A4, A5             | Faz 4                                | Faz 4 süre sonu testi                                               | PLANLANDI |
| R-AUD-01    | Audit INSERT-only; UPDATE/DELETE DB'de reddedilir                                    | A4                 | Migration + tetikleyici              | migrations.test.ts (PGlite, 4 test)                                 | KODLANDI  |
| R-AUD-02    | SHA-256 hash zinciri; doğrulama komutu                                               | A4                 | `AuditService`                       | Faz 1 tahrifat testi                                                | PLANLANDI |
| R-AUD-03    | Audit'e içerik/secret/parola yazılmaz                                                | A4                 | `AuditService`                       | Faz 1 log sızıntı testi                                             | PLANLANDI |
| R-FILE-01   | Yükleme: boyut → tür → SHA-256 → karantina → AV → objects                            | A4                 | Yükleme hattı                        | Faz 2 zararlı dosya testleri                                        | PLANLANDI |
| R-FILE-02   | AV erişilemezse karantinada kalır                                                    | A4                 | Yükleme hattı                        | Faz 2                                                               | PLANLANDI |
| R-FILE-03   | Herkese açık URL yok; imzalı URL 60 sn                                               | A4                 | Storage adaptörü                     | Faz 1/2                                                             | PLANLANDI |
| R-SEARCH-01 | Türkçe normalizasyon (İ/i, I/ı, ş, ğ, ü, ö, ç)                                       | A4                 | `normalizeTr`                        | migrations.test.ts (searchVector). unaccent: DOĞRULANMADI           | KODLANDI  |
| R-LC-01     | `ingestStatus` ve `lifecycleStatus` ayrı eksenler                                    | A6                 | `packages/core/states` (tip)         | schema.test.ts (enum eşitliği) + migrations.test.ts (profil CHECK)  | KODLANDI  |
| R-LC-02     | Geçiş tablosu dışı her geçiş reddedilir                                              | A6                 | Durum makinesi                       | Faz 2/3 birim testleri                                              | KODLANDI  |
| R-LC-03     | Tüm onaylar olmadan `READY_FOR_SIGNATURE` yok                                        | A6                 | Sözleşme servisi                     | Faz 3                                                               | DOĞRULANDI|
| R-LC-04     | İmza kanıtı olmadan `ACTIVE` yok                                                     | A6                 | Sözleşme servisi                     | Faz 3                                                               | DOĞRULANDI|
| R-LC-05     | `ACTIVE` imzalı sürüm değişmez                                                       | A6                 | Sürümleme                            | Faz 3                                                               | KODLANDI  |
| R-LC-06     | `IMPORTED_HISTORICAL` onay gibi gösterilmez                                          | A6                 | Sözleşme servisi/UI                  | Faz 3                                                               | KODLANDI  |
| R-WF-01     | Başlamış örnek tanım sürümüne sabitlenir                                             | A4/Faz 3           | İş akışı motoru                      | Faz 3                                                               | KODLANDI  |
| R-WF-02     | Onay matrisi yoksa akış başlatılamaz                                                 | A5/2, Faz 3        | İş akışı motoru                      | Faz 3                                                               | KODLANDI  |
| R-WF-03     | Başlatan kişi kendi onayını veremez (yapılandırılabilir)                             | Faz 3              | İş akışı motoru                      | Faz 3                                                               | KODLANDI  |
| R-RNW-01    | Yenileme/ihbar tarihi yalnızca doğrulanmış kuralla; aksi `NEEDS_MANUAL_VERIFICATION` | Faz 3              | `packages/core/dates`                | Faz 3                                                               | KODLANDI  |
| R-RET-01    | Evrensel varsayılan saklama süresi kodlanmaz                                         | A5/2, A5/3         | `packages/core/retention`            | Faz 4                                                               | PLANLANDI |
| R-RET-02    | Profili olmayan veya doğrulanmamış kayıt otomatik imha edilmez                       | Faz 4              | Saklama servisi                      | Faz 4                                                               | PLANLANDI |
| R-RET-03    | Hukuki bekletme imha/silmeyi her durumda bloke eder                                  | A6                 | Saklama servisi                      | Faz 4                                                               | PLANLANDI |
| R-DISP-01   | İmha ikinci ve farklı onaycı ister                                                   | Faz 4              | İmha akışı                           | Faz 4                                                               | PLANLANDI |
| R-AI-01     | AI kapalıyken çekirdek çalışır                                                       | A5/5               | `AiProvider`                         | `faz6` testleri: AI kapalıyken çekirdek akış (E2E + birim)           | KODLANDI  |
| R-AI-02     | Kritik alan `VERIFIED` olmadan alarm/yazım yok                                       | A5/5               | Çıkarım servisi                      | `faz6` testleri: kritik alan VERIFIED kontrolü; alarm yok            | KODLANDI  |
| R-AI-03     | AI'ya araç/yazma yetkisi yok; çıktı şema ile doğrulanır                              | A5/5               | AI adaptörü                          | `faz6` testleri: enjekte talimat sonucu değiştirmez; şema doğrulaması | KODLANDI  |
| R-SEC-01    | Hata yanıtı `{code,message,correlationId}`; sızıntı yok                              | A5/7               | API                                  | Faz 1                                                               | PLANLANDI |
| R-SEC-02    | Secret yalnızca env/secret manager; `.env.example` boş                               | A5/7               | Yapılandırma                         | Faz 0a (dosya) / Faz 7                                              | KODLANDI  |
| R-SEC-03    | Üretim build'inde fixture/demo verisi yok                                            | A5/1               | Build                                | Faz 7                                                               | PLANLANDI |
| R-UI-01     | Türkçe arayüz, Europe/Istanbul gösterimi                                             | A4                 | `apps/web`                           | Faz 5                                                               | PLANLANDI |
| R-UI-02     | Sahte KPI/grafik yok; "veri yok" durumu                                              | A5/4, Faz 5        | Dashboard                            | Faz 5                                                               | PLANLANDI |
| R-UI-03     | WCAG 2.2 AA hedefi; axe denetimi                                                     | Faz 5              | UI                                   | Faz 5                                                               | PLANLANDI |
| R-CMP-01    | Uyumluluk iddiası yok; hukuk işaretleri                                              | A5/3               | Dokümantasyon                        | Faz 7                                                               | PLANLANDI |
| R-OPS-01    | Docker Compose: postgres, redis, minio, clamav, web, worker                          | Faz 0              | `docker/docker-compose.yml`          | `docker compose up -d` (kullanıcı)                                  | KODLANDI  |
| R-OPS-02    | CI: lint, typecheck, test, build                                                     | Faz 0              | `.github/workflows/ci.yml`           | CI çalıştırması (kullanıcı)                                         | KODLANDI  |
| R-OPS-03    | İlk migration üretimi                                                                | Faz 0b             | `packages/db`                        | PGlite testleri; gerçek PG: `pnpm db:migrate` (kullanıcı)           | KODLANDI  |
| R-DB-01     | Şema kapsamı: Faz 0 listesindeki tüm varlıklar                                       | Faz 0b             | `packages/db/prisma/schema/*.prisma` | schema.test.ts (60 model)                                           | KODLANDI  |
| R-DB-02     | Enum'lar A6 ile birebir (core ↔ Prisma)                                              | A6                 | enum tanımları                       | schema.test.ts                                                      | KODLANDI  |
| R-DB-03     | Salt-okunur/imzalı sürüm veritabanında korunur                                       | A6                 | 0002 `ekos_version_readonly_guard`   | migrations.test.ts (4 test)                                         | KODLANDI  |
| R-DB-04     | Membership: tam olarak bir özne (kullanıcı veya grup)                                | A4                 | 0002 CHECK                           | migrations.test.ts                                                  | KODLANDI  |
| R-DB-05     | Red kararında gerekçe zorunlu                                                        | A4, Faz 3          | 0002 CHECK                           | migrations.test.ts                                                  | DOĞRULANDI|
| R-DB-06     | Break-glass iki kişi ilkesi ve süre penceresi                                        | A4                 | 0002 CHECK                           | migrations.test.ts                                                  | KODLANDI  |
| R-DB-07     | Denetim: UPDATE/DELETE/TRUNCATE reddedilir                                           | A4                 | 0002 trigger + REVOKE                | migrations.test.ts                                                  | KODLANDI  |

## Faz 7 — Güvenlik, operasyon, yedekleme

Durum: tüm satırlar `KODLANDI` (agent sandbox'ında çalıştırıldı, geçti). Hiçbiri kullanıcı tarafından `DOĞRULANDI` değildir. Ayrıntı: `docs/FAZ7_DURUM.md`.

| ID | Gereksinim | Kaynak | Uygulama | Test | Durum |
| --- | --- | --- | --- | --- | --- |
| R-F7-01 | XSS: HTML enjeksiyon API'leri yok | Faz 7 | statik denetim | security.test.ts | KODLANDI |
| R-F7-02 | Path traversal: dosya adı depolama anahtarını etkilemez | Faz 7 | upload.ts (UUID anahtar) | security.test.ts | KODLANDI |
| R-F7-03 | Dosya sahteciliği: uzantı ile ikili başlık uyuşmalı | Faz 7 | upload-validation (core) | security.test.ts | KODLANDI |
| R-F7-04 | SQLi: arama girdisi parametre, tablo sağlam | Faz 7 | Prisma parametreli sorgu | security.test.ts | KODLANDI |
| R-F7-05 | Arama sızıntısı: yetkisiz aktör boş sonuç | Faz 7 | searchDocuments | security.test.ts | KODLANDI |
| R-F7-06 | Tarama yoksa dosya kullanılamaz (karantina) | Faz 7 | upload.ts, scanFile | security.test.ts | KODLANDI |
| R-F7-07 | CSRF: durum değiştiren uçlar origin denetimi veya gerekçeli istisna | Faz 7 | requireApiActor / sameOrigin | security.test.ts | KODLANDI |
| R-F7-08 | SSRF: e-imza adresi https zorunlu | Faz 7 | esignature.ts readESignConfig | esignature-config.test.ts | KODLANDI (mock) |
| R-F7-09 | İndirme URL'i kalıcı/imzalı değil | Faz 7 | statik denetim | security.test.ts | KODLANDI |
| R-F7-10 | Log hijyeni: secret/parola/token/e-posta loglanmaz | Faz 7 | statik denetim | security.test.ts | KODLANDI |
| R-F7-11 | SMTP hata çıktısı kimlik bilgisi sızdırmaz | Faz 7 | notify/smtp.ts | smtp.test.ts | KODLANDI |
| R-F7-12 | Eşzamanlı çelişki: VERSION_CONFLICT | Faz 7 | createNewVersion, physical-archive | concurrency.test.ts | KODLANDI |
| R-F7-13 | E-imza → imzalı sürüm; sözleşme ACTIVE yalnız CLEAN + kanıt | Faz 7 | esign.ts, lifecycle.ts | esign-version.test.ts, lifecycle.test.ts | KODLANDI (mock) |
| R-F7-14 | Yedek/geri yükleme; boş hedef, aynı migration, bütünlük | Faz 7 | ops/backup.ts, scripts/backup.ts | backup.test.ts | KODLANDI |
| R-F7-15 | Üretim yapılandırma doğrulaması; hatada başlatma reddi | Faz 7 | core/config/runtime-config.ts, apps/web/instrumentation.ts | runtime-config.test.ts, env-example.test.ts | KODLANDI |
| R-F7-16 | Yapılandırılabilir limitler; aralık dışı ERROR | Faz 7 | runtime-config.ts (limits) | runtime-config.test.ts | KODLANDI |
| R-F7-17 | Migration'da veri silen komut yok | Faz 7 | prisma/migrations | security.test.ts | KODLANDI |
| R-F7-18 | Üretim derlemesinde demo verisi/dev parolası yok | Faz 7 | next build çıktısı | security.test.ts | KODLANDI |
| R-F7-19 | Uyarı eşikleri (denetim olayları, PII'siz çıktı) | Faz 7 | ops/alerts.ts, dispatchSecurityAlerts, jobs.ts | alerts.test.ts (7) | KODLANDI (in-app; e-posta/Teams NOT_CONFIGURED) |
| R-F7-20 | Bağımlılık açıkları (pnpm audit) temiz | Faz 7 | package.json overrides; vitest 4; nodemailer 10 | `pnpm audit` | KODLANDI |
| R-F7-21 | Yıkıcı komut yasağı (kod, CI, Docker, betikler) | Faz 7 | statik denetim | security.test.ts | KODLANDI |
| R-F7-22 | IDOR → 404; rol yükseltme → 403 | Faz 6/7 | mevcut yetki katmanı | governance.test.ts; E2E faz5 + faz7 (IDOR, rol yükseltme, denetim) | KODLANDI (agent E2E geçti) |
| R-F7-23 | Eşzamanlı/çelişki E2E; saklama/hold/imha E2E; sözleşme onay E2E | Faz 7 | — | e2e/faz7.spec.ts; e2e/sozlesme-akisi.spec.ts (50/50) | KODLANDI (agent E2E geçti) |
| R-F7-24 | Dış sağlayıcı canlı testleri (e-imza, SMTP, ClamAV, OIDC) | Faz 7 | — | Kimlik bilgisi yok: mock etiketli | PLANLANDI |
| R-F7-25 | RPO/RTO | Faz 7 | — | Kurum onayı yok: taahhüt EDİLMEZ | PLANLANDI |
| R-F7-26 | Go-live onayları (hukuk, mali, İK, veri koruma) | Faz 7 | — | Bu ortamda alınamaz | PLANLANDI |
| R-F7-27 | Container imajları (çok aşamalı, non-root) ve güvenlik taraması | Faz 7 | docker/*.Dockerfile, docker-compose.yml | Semgrep p/dockerfile: 0 bulgu; worker deploy yerelde çalıştı | KODLANDI; imaj derlenmedi (Docker yok) |

| R-F7-28 | Sağlık uç noktası gerçek DB/depolama kontrolü; 503 hatada | Faz 7 | apps/web/app/api/health/route.ts | standalone çalışma zamanında 200 (agent) | KODLANDI |
| R-F7-29 | Standalone çıktıda Prisma sorgu motoru dahil | Faz 7 | apps/web/next.config.mjs (outputFileTracingIncludes) | standalone /api/health 200 | KODLANDI |
| R-F7-30 | E2E kurulumu parolasız sessiz atlama (açık hata yapılmadı) | Faz 7 | e2e/global-setup.ts | E2E koşusu (parola ile 50/50) | AÇIK İYİLEŞTİRME |
| R-F7-31 | Alpine `tesseract-ocr-data-tur` paket adı | Faz 7 | docker/worker.Dockerfile | Docker yok | DOĞRULANMADI |