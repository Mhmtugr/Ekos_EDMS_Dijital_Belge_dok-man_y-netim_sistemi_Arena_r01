# Faz 5 — Durum Raporu

Tarih: 2026-10-14 (Europe/Istanbul). Bu rapor yalnızca çalıştırılarak doğrulanmış ifadeleri içerir.

## DOĞRULANDI

Komutlar: `tsc -p packages/db/tsconfig.json --noEmit` → 0 hata. `vitest run packages/db packages/core` → 32 dosya, 363 test geçti (Faz 4 testleri dahil; gerileme yok).

| Alan | Dosya | Kanıt (test) |
|---|---|---|
| Hatırlatma idempotensi | `operations/reminders.ts` | `faz5.test.ts`: iki eşitleme, ikincisi 0 kayıt |
| Tarih değişince yeniden üretim | `reminders.ts` | eski planlar CANCELLED, yeni tarihle SCHEDULED |
| Tetikleme tekilleştirme | `reminders.ts` | ikinci tetikleme `fired = 0` |
| Bildirim dedupeKey | `notifications.ts` | aynı anahtar ikinci kez 0 |
| Yapılandırılmamış kanal | `notifications.ts` | `NOT_CONFIGURED` kaydı; uygulama içi bildirim görünür |
| Teslim hatası görünürlüğü | `notifications.ts` | 5 başarısız deneme → iş `DEAD`, `FAILED` denemeler, `DELIVERY_ESCALATION` yöneticiye, kayıt kullanıcıda kalır |
| Dashboard metrik-DB eşleşmesi | `operations/dashboard.ts` | `contractsVisible` ve `endingWithin90` doğrudan sayımla eşleşir |
| Dashboard yetki filtresi | `dashboard.ts` | yetkisiz kullanıcı: belge erişimi kapalı, sayımlar 0; kapsamlı kullanıcı yalnız kendi departmanı |
| Dışa aktarma yetki + audit | `operations/reports.ts` | yetkisiz → FORBIDDEN + `REPORT_EXPORT_DENIED`/DENIED; başarı → `REPORT_EXPORTED_RESTRICTED`/SUCCESS |
| Filigran ve kısıtlı indirme | `reports.ts` | `FİLİGRAN: KISITLI`, dosya adında `_KISITLI`, kapsam özeti |
| Denetim raporu sınırı | `reports.ts` | yalnız kapsamsız `audit.export`; kapsamlı denetçi reddedilir |
| Vekalet kuralları | `tasks.ts` | gerekçe zorunlu, kendine vekalet yok, 90 günü aşan yok |
| CSV biçimi | `exports.ts` | BOM, RFC 4180 kaçışı, formül enjeksiyonu koruması |
| XLSX biçimi | `exports.ts` | `openpyxl` ile açılıp hücre değerleri okundu (Türkçe karakter, sayı, formül koruması) |
| CRC32 / zip | `exports.ts` | bilinen değer `CBF43926`; zip merkezi dizin ve CRC doğrulaması |

Düzeltilen gerçek hatalar (bu turda): sahte `|| true` erişim bayrakları; genel yetki kontrollerinin kapsamlı üyeliğe açık olması; kapsamlı kullanıcının belge raporlarını alamaması; yanlış ilişki adı (`rolePermissions` → `permissions`); `WorkflowStep.name` yok; `VALIDATION_FAILED` ve `SETTING_STATE_INVALID` hata kodları eksikti.

Ek (Faz 4 açıkları): şema sapma kontrolü (`packages/db/src/schema-drift.test.ts`) gerçek sapmaları yakaladı ve düzeltti; tam set 35 dosya / 394 test geçiyor. Ayrıntı: `docs/FAZ4_RAPOR.md` §7.

## DOĞRULANMADI

- `nodemailer` kurulmadı (npm sürümü 10.1.1). E-posta teslimi gerçek SMTP ile DOĞRULANMADI; yalnızca sahte gönderici portuyla test edildi.
- `@axe-core/playwright` kurulmadı (4.13.0). axe/WCAG 2.2 AA denetimi YAPILMADI.
- Playwright E2E yazılmadı; tarayıcı başlatma DOĞRULANMADI.
- `decideApprovalTask` vekil yazımı (`delegatedFromId`) için test yazılmadı; yalnızca derleme doğrulandı.
- Dashboard'daki `approvalsTeam` ve `obligations` SQL sorguları PostgreSQL'de çalıştırıldı ancak yalnızca dolu veriyle sınandı; boş-veri durumu ayrıca test edilmedi.

## EKSİK (Faz 5 kapsamı, henüz yazılmadı)

- Next.js UI: sol navigasyon (Genel Bakış, Belgeler, Sözleşmeler, Karşı Taraflar, Onaylar/Görevler, Yüklemeler/İçe Aktarım, Raporlar, Denetim, Yönetim, Sistem Sağlığı), Türkçe metinler, klavye, mobil, toplu işlem, kayıtlı görünümler.
- Kurulum sihirbazı (ikinci onay, eksik kritik yapılandırmanın bloke ettiği işlevi gösterme).
- Onaylar/Görevler ekranı ve vekalet ekranı.
- Raporlar ekranı ve dışa aktarma düğmeleri; PDF çıktısı yok (yalnız CSV/XLSX).
- Sistem Sağlığı ekranı.
- Faz 4'ten kalan: bekletmede imha için HTTP 409 testi (servis düzeyinde doğrulandı) ve tarayıcıda UI etkileşim testi.

## Çalışma zamanı doğrulaması (güncel)

### Tamamlanan (bu tur)
- **Hatırlatma ve bildirim işleri bağlandı:** `runReminderCycle` ve `runNotificationWorker` artık `apps/web/lib/server/jobs.ts` üzerinden çağrılıyor. API: `POST /api/jobs/run` (config.manage). Zamanlı çalıştırma: `apps/web/scripts/run-jobs.ts` (`JOBS_ACTOR_EMAIL`, `JOBS_INTERVAL_SECONDS`).
- **Göndericiler (`packages/adapters/src/notify`):** SMTP (nodemailer, `SMTP_URL` ortam değişkeni) ve Teams gelen kancası (`TEAMS_WEBHOOK_URL`). Ayar etkin değilse ya da ortam değişkeni yoksa kanal `null` döner ve teslim `NOT_CONFIGURED` olarak kaydedilir; sahte "Gönderildi" yazılmaz. Hata metinleri URL/parola içermez.
- **API:** `GET /api/notifications`, `POST /api/notifications/[id]/read`, `GET|POST /api/settings`, `POST /api/settings/approve`, `POST /api/settings/cancel`, `POST /api/jobs/run`.
- **Ekranlar:** `/yonetim/bildirimler` (kanal durumu, teslim durumları, okundu), `/yonetim/hatirlatma` (aralık ayarı, 90 günlük zamanlanmış olaylar, elle çalıştırma), `/yonetim/kurulum` (kritik ayar durumu, bloke ettiği işlev, ikinci onay, iptal, sürüm çakışması, gizli değerlerin yalnızca ortam değişkeni adıyla girilmesi). Navigasyona "Bildirimler", "Hatırlatmalar" ve "Kurulum" eklendi.
- **Testler:**
  - `packages/adapters/src/notify/notify.test.ts`: 5 test (Teams 2xx/5xx/ulaşılamaz, SMTP geçersiz alıcı ve parola sızdırmama).
  - `packages/db/src/operations/settings.test.ts`: 7 entegrasyon testi (ikinci onay, öneren kişinin onaylayamaması, iptal, sürüm çakışması, doğrulama, yetki).
  - Kök vitest: 37 dosya, 406 test geçti.
  - `apps/web` ve `packages/db`, `packages/adapters` tsc: 0 hata.
- **E2E:** `e2e/faz5.spec.ts` 19/19 geçiyor. Yeni: kullanıcı yetki sınırı, hatırlatma ayarı doğrulama ve kayıt, 11 ekran için axe.
- **Altyapı düzeltmeleri:** E2E için global setup (oturum çerezi, giriş hız sınırı aşılmıyor). Geliştirme veri dizini izin/bozulma sorunu için yeniden oluşturuldu.

### Doğrulanan çalışma zamanı davranışı (HTTP)
- Yetki: kullanıcı `/api/settings` → 403, `/api/jobs/run` → 403; yönetici → 200.
- CSRF: Origin olmadan POST → 403.
- Doğrulama: geçersiz hatırlatma aralığı → 422.
- Kritik ayar: öneri → 202 (`PENDING_SECOND_APPROVAL`); aynı kişi onaylar → 403; eski sürüm → 409; iptal → 200.
- Boş sistemde hatırlatma/teslim sayımları sıfır (sahte veri yok).

### Hâlâ açık
- Gerçek SMTP sunucusu ve gerçek Teams kanalına teslim: yalnızca yerel sahte sunucuyla test edildi.
- E2E: arama, belge yükleme (Belgeler/Yüklemeler akışı) ve hatırlatma olayının uçtan uca üretilmesi. Sözleşme oluşturma→alanlar→onay→karar akışı E2E'si yazıldı (bkz. aşağıdaki bölüm).
- Belgeler / Yüklemeler / İçe Aktarım için derin işlevsel testler (şu an ekran erişimi ve axe).
- Zamanlayıcının sunucuda kalıcı olarak (systemd/cron) kurulumu.
- PDF dışa aktarma: bu sürümde yok.
- `DOMAIN_TO_API` eşlemesi doğrulanmadı.
- Lint çalıştırılmadı (2 GB RAM sınırında derleme için `--no-lint` kullanıldı).

## Bu tur: sözleşme yaşam döngüsü UI, alan servisi ve E2E

### Eklenenler
- **Alan servisi:** `updateContractFields` (`packages/db/src/contracts/lifecycle.ts`): yalnız DRAFT/IN_REVIEW; `rowVersion` uyuşmazlığı → `VERSION_CONFLICT`; denetim `CONTRACT_FIELDS_UPDATED`. Doğrulama: tarih biçimi, bitiş ≥ başlangıç, tutar+para birimi birlikte, ihbar değer+birim birlikte (1–3650).
- **API:** `POST /api/contracts/[id]/fields` (contract.create, CSRF, rowVersion zorunlu); `POST /api/contracts/upload` (multipart: dosya + sözleşme alanları; yetki contract.create + document.upload; yükleme karantinası; tarama yapılandırılmışsa tarama).
- **Ekranlar:** `/yonetim/sozlesmeler/yeni` (dosyalı taslak oluşturma); sözleşme detayında alan düzenleme formu, onay akışı başlatma düğmesi (yayımlı matris yoksa açık hata), imza kanıtı formu; `/yonetim/gorevler` içinde tekil karar (onayla / gerekçeli geri gönder / gerekçeli reddet) ve toplu onay (satır satır sonuç raporu).
- **İmza kapısı:** `recordSignatureAndActivate` artık dosyanın `scanStatus = CLEAN` olmasını şart koşar; aksi halde `TRANSITION_DENIED` ("taramadan geçmeden imzalanamaz"). Sahte "temiz" sonuç üretilmez.
- **Geliştirme yapılandırması:** `sozlesme@ekos.test` (CONTRACT_MANAGER, kurum geneli); `CONTRACT_APPROVAL` için tek adımlı yayımlı matris (onayci@ekos.test). `dev-users.ts` idempotenttir.

### Testler
- `packages/db/src/contracts/fields.test.ts`: 9 test (kayıt + denetim, sürüm çakışması, tarih/tutar/ihbar doğrulaması, ACTIVE'de reddetme, NOT_FOUND, imza kapısı: PENDING reddedilir, CLEAN olunca ACTIVE).
- Kök vitest: 38 dosya, 415 test geçti.
- `e2e/sozlesme-akisi.spec.ts`: yetkisiz erişim, taslak oluşturma (dosyalı), alan kaydı, sürüm/tarih hatası, onay başlatma, onaycının görevi onaylaması, taranmamış dosyada imzanın reddi.
- Toplam Playwright: 25/25 geçti (`e2e/faz5.spec.ts` 19 + `e2e/sozlesme-akisi.spec.ts` 6).

### Önemli bulgu (ürün kararı gerekli)
- Bu sandbox'ta ClamAV'ye ulaşılamıyor (`CLAMD_HOST` tanımlı, servis kapalı; veritabanı indirme adresi 403). Bu nedenle **tarama başarılı sonucu ve dolayısıyla gerçek imzayla yürürlük E2E'si bu ortamda DOĞRULANMADI.** Üretimde tarama servisi ayakta olmalıdır.

### Hâlâ açık (bu turda kapsanmadı)
- Gerçek ClamAV taramasıyla imza → ACTIVE pozitif yolu.
- Sol navigasyon yeniden tasarımı ve Genel Bakış, Raporlar (PDF), Sistem Sağlığı, Denetim ekranlarının tam işlevsel testleri.
- Kurulum sihirbazı tam UI; gerçek SMTP/Teams teslimi; `DOMAIN_TO_API`; lint.
- Veri notu: E2E her koşuda gerçek akışla yeni sözleşme kaydı üretir (geliştirme DB'sinde birikir).
