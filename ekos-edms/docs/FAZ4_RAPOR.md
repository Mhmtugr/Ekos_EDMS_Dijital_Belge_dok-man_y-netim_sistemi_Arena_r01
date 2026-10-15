# Faz 4 — Saklama, Hukuki Bekletme, İmha, Ayrılış, Kırılma-Cam, Denetim Kanıtı

Durum: **Kod kapsamı tamamlandı (açık kalemler kapatıldı).** Otomatik kontroller (tip denetimi, ESLint, veritabanı ve HTTP testleri, derleme) bu raporda DOĞRULANDI olarak işaretlidir. Tarayıcıda uçtan uca UI kabul testi **DOĞRULANMADI**; bu madde çalıştırılmadan "görsel olarak tamam" sayılmaz.

## 1. Kapsam ve uygulanan kararlar

| Madde | Uygulama | Dosya |
|---|---|---|
| Saklama profili (sürümlü) | Her kural değişikliği yeni `RetentionRuleVersion`; `verifiedByLegal` kural değişince sıfırlanır; evrensel varsayılan süre YOK; eksik profil → "politika bekliyor" / politika eksiği | `packages/db/src/governance/retention.ts` |
| Hukuki doğrulama | Dayanak notu, başlangıç olayı, süre, birim, imha yöntemi ve en az iki imha onaycısı zorunlu; yetki `contract.legal_review` | `retention.ts` |
| Mali yıl sonu takvimi (FISCAL_YEAR_END) | Yıl → mali yıl sonu tarihi tablosu (`FiscalYearEnd`, yıl benzersiz, sürüm kontrollü). Yıl girilmemişse başlangıç **çözülmez** (uydurma tarih yok). Retention ve imha tarama varsayılanı artık DB'den okunur. Her kayıt denetime yazılır (`FISCAL_YEAR_END_SET`) | `fiscal.ts`, migrasyon 0012 |
| İmha uygunluğu | Tek kaynak `computeDisposalEligibility`: profil, bekletme, aktif sözleşme, açık yükümlülük, bağımlı kayıt, onay, denetim tablosu engelleri | `retention.ts`, `packages/core/src/retention/governance.ts` |
| Hukuki bekletme | Kayıt + tüm sürümler + dosya nesneleri + OCR işleri + çıkarımlar kapsamı; bekletmede imha/silme engelli (uygulama + DB tetikleyicisi); her deneme (görünmeyen dahil) denetime yazılır | `holds.ts`, migrasyon 0010 |
| İmha akışı | Süre dolumu tarama → `DISPOSAL_REVIEW` kuyruğu → inceleyen → ikinci ve FARKLI onaycı → yalnız `APPROVED` için yürütücü | `disposal.ts` |
| Yürütme | Tek işlemde: belge kilidi, engel yeniden kontrolü, veritabanı silme (dosya, sürüm, OCR, çıkarım, metadata, ACL), arama metni boşaltma, depo silme (hata → geri alma), içeriksiz `DisposalManifest` (kanonik SHA-256) | `disposal.ts` |
| Fiziksel imha kanıtı | `PHYSICAL_DESTRUCTION_RECORD` yönteminde ikinci onayda `physicalEvidenceRef` zorunlu; ayrı kanıt alanı olarak saklanır ve tutanakta ayrı satırda yer alır | `disposal.ts`, `certificate.ts` |
| İmha tutanağı (PDF) | Harici kütüphanesiz PDF 1.4 yazıcı (Helvetica + Differences ile Türkçe harfler). Yalnızca içeriksiz manifest alanları. Manifest bütünlüğü doğrulanmadan üretilmez. Her indirme denetime yazılır (`DISPOSAL_CERTIFICATE_EXPORTED`, tutanak SHA-256 ile). Yetki: `config.manage` | `certificate.ts`, `apps/web/app/api/disposal/reviews/[id]/certificate/route.ts` |
| Ayrılış | Sahiplik, sözleşme rolleri, yükümlülük ve bekleyen onay görevleri; devir; hesap `OFFBOARDING` → `DISABLED`; oturumlar kapanır; engelleyici mod (bırakma yok) ve engellemeyen mod (gerekçeli bırakma + uyarı) | `offboarding.ts` |
| Ayrılış dosyası iptali | Yalnızca `OPEN` dosya iptal edilir; gerekçe zorunlu; sürüm kontrollü; hesap `ACTIVE`'e döner (bir kullanıcının aynı anda yalnız bir açık dosyası olabilir, çünkü açılış yalnız `ACTIVE` hesapta yapılır). Tamamlanmış dosya iptal edilemez. Audit: `OFFBOARDING_CANCELLED` | `offboarding.ts`, migrasyon 0011/0012 |
| Ayrılış listesi | Durum filtresi (`OPEN`, `COMPLETED`, `CANCELLED`) ile liste; `GET /api/offboarding?status=` | `offboarding.ts`, `ayrilis/page.tsx` |
| Kullanıcı seçici | Ad veya e-posta ile arama; yalnız `ACTIVE` hesaplar; en çok 20 sonuç; yalnız kimlik/ad/e-posta döner. Ayrılış açma ve devir formları UUID yerine bunu kullanır | `offboarding.ts` (`searchActiveUsers`), `ayrilis/UserPicker.tsx`, `GET /api/users/picker` |
| Kırılma-cam | Talep (gerekçe, izin, belge, süre 15–240 dk); onay talep edenden farklı ve `breakglass.approve` ister; süre onayda başlar; süre sonunda erişim kapanır; kullanım `BREAK_GLASS` actorType ile denetlenir | `breakglass.ts`, `documents/guard.ts`, `actor.ts` |
| Kırılma-cam sayfalama | Sayfa başına 50 kayıt, `hasMore` ile önceki/sonraki sayfa bağlantıları; sayfa parametresi doğrulanır (≥ 1) | `breakglass.ts`, `yonetim/kirilma-cam/page.tsx`, `api/breakglass` |
| Kanıt paketi | Yalnızca görülebilen belgeler; sistem olayları yalnızca kapsamsız `audit.export`; aralık ≤ 366 gün, Europe/Istanbul; SHA-256 checksum; `verifyEvidencePack`; dışa aktarma denetime yazılır | `evidence.ts` |
| Denetim filtreleri | Tarih, olay türü, hedef türü, kullanıcı kimliği, sonuç, aktör türü; zincir bütünlük durumu | `yonetim/denetim/page.tsx` |

## 2. Arayüz (UI)

| Ekran | Yol | İçerik |
|---|---|---|
| Saklama profilleri | `/yonetim/saklama` | Profil tablosu (politika eksiği görünür), **mali yıl sonu takvimi** (config.manage; tablo + giriş formu, sürüm kontrollü), yeni profil formu, hukuki doğrulama (contract.legal_review) |
| İmha kuyruğu | `/yonetim/imha` | Kuyruk (yalnızca görülebilen belgeler), karar formu (onay / uzat / reddet, gerekçe, fiziksel kanıt referansı), tarama ve yürütücü düğmeleri (config.manage), **yürütülmüş imha listesi + tutanak PDF bağlantısı** (config.manage) |
| Çalışan ayrılışı | `/yonetim/ayrilis` | **Dosya listesi ve durum filtresi**, vaka açma (kullanıcı seçici), vaka görüntüleme, kalem bazlı devir / gerekçeli feragat, tamamlama, **dosya iptali (gerekçeli)** |
| Kırılma-cam | `/yonetim/kirilma-cam` | Talep formu, **sayfalı** talep listesi, onay / red (breakglass.approve, talep edenden farklı), iptal |
| Denetim | `/yonetim/denetim` | Filtreli olay listesi, zincir durumu, kanıt paketi JSON indirme (`/api/audit/evidence-pack`) |
| Belge detayı | `/yonetim/belgeler/[id]` | Saklama özeti (profil, politika, vade, bekletme, hukuk işareti, uygunluk), bekletme koy / kaldır, profil ataması, başlangıç olayı kaydı |

Ortak istemci yardımcısı: `apps/web/app/yonetim/gov-client.ts` (`callApi`, `messageOf`, `field`).

## 3. Hatalar ve düzeltmeler

Önceki turlar (1–10): migrasyon sütun adı, manifest kanonik özeti, görünmeyen belgede denetim boşluğu, kırılma-cam görünürlüğü, denetim `targetType`, GET rotalarında CSRF/Origin hatası (yalnızca durum değiştiren yöntemlerde denetleniyor), `retentionDueAt` geçersiz tarih, form sıfırlama, ESLint.

Bu turda bulunan ve düzeltilen hatalar:

1. **Migrasyon 0011 çalışmıyordu** — PostgreSQL, aynı işlemde eklenen enum değerinin kullanılmasına izin vermez (`55P04`). Migrasyon ikiye bölündü: `0011_faz4_enum_cancelled` (yalnız `ADD VALUE`), `0012_faz4_closeout` (iptal alanları, `FiscalYearEnd`).
2. **`FiscalYearEnd` şema kuralını ihlal ediyordu** — "her model UUIDv7 kimlik kullanır" testi başarısız. Yıl anahtarı korundu; `id` UUIDv7 yapıldı, `year` benzersiz.
3. **Kırılma-cam sayfası** yeni `{items, hasMore, page}` yanıtını kullanmıyordu (tip hatası). Sayfa yeniden yazıldı.
4. **Web tip denetimi** test dosyasında üç hata (`.ts` uzantılı import, `RequestInit` gövdesi) — düzeltildi.
5. **ESLint** — 10 hata (boş dönüşlü ok fonksiyonları, gereksiz cast'ler, `String(object)`) düzeltildi; tüm depo `--max-warnings=0` ile temiz.
6. **Test altyapısı yanlışlığı** — önceki raporlarda "PGlite" yazıyordu. Doğrusu: testler `embedded-postgres` ile **gerçek PostgreSQL 16** açar (`packages/db/src/testing/pg-harness.ts`).
7. **Geliştirme veritabanı** — `0010`, `0011`, `0012` uygulanmamıştı. `prisma migrate deploy` ile uygulandı (yalnız ekleyici değişiklikler; veri silinmedi). Şema şu an güncel.
8. **Çalışan önizleme sunucusu** eski derlemeyi sunuyordu (GET rotaları 405). Derleme yenilendi ve `next start -H 0.0.0.0 -p 3000` ile yeniden başlatıldı.

## 4. Doğrulama durumu

| Kontrol | Sonuç | Not |
|---|---|---|
| `prisma validate` / `prisma generate` | DOĞRULANDI | |
| `packages/db` tsc | DOĞRULANDI — EXIT=0 | |
| `apps/web` tsc (testler dahil) | DOĞRULANDI — EXIT=0 | |
| ESLint (`eslint . --max-warnings=0`) | DOĞRULANDI — EXIT=0 | Tüm depo |
| Tüm vitest seti (`--no-file-parallelism`) | DOĞRULANDI — 32 dosya, 372 test, hepsi geçti | Gerçek PostgreSQL 16 |
| `faz4-closeout.test.ts` (yeni) | DOĞRULANDI — 11/11 | Mali yıl (yetki, doğrulama, sürüm, saklama çözümü), ayrılış iptali (gerekçe, sürüm, durum, liste filtresi), kullanıcı seçici (yalnız aktif), bekleyen onay görevi engeli (engelleyici mod, feragat reddi, iptal çıkışı), kırılma-cam sayfalama (50 + 1), PDF xref/ofset yapısı, tutanak içeriği, yürütülmüş imha → tutanak (yetki, audit, SHA-256) |
| `governance.test.ts` | DOĞRULANDI — 14/14 | Profil yokken imha yok; doğrulama eksikleri; sürümleme; başlangıç olayları; bekletme engeli + audit; DB tetikleyici reddi; çift onay; manifest ve temizlik; red; ayrılış; engellemeyen mod; kırılma-cam süre sonu; süre sınırları; kanıt paketi yetki sınırı ve checksum |
| `apps/web/tests/faz4-routes.test.ts` (yeni) | DOĞRULANDI — 7/7 | Gerçek route handler'ları + gerçek DB + oturum satırı: oturumsuz 401, yetkisiz 403, yabancı Origin 403 `CSRF_REJECTED`, kullanıcı seçici (yalnız aktif, yalnız üç alan), mali yıl (422/200/409), ayrılış (aç 201, filtre, 422 gerekçe, iptal 200, tekrar iptal 409), kırılma-cam sayfa doğrulaması ve yapısı, yürütülmüş imha listesi ve bilinmeyen tutanak 404 |
| `packages/core` (`codes.test.ts` dahil) | DOĞRULANDI (tam set içinde) | Yeni izin kodu eklenmedi; `docs/PERMISSIONS.md` değişmedi |
| Derleme `next build --no-lint` | DOĞRULANDI — EXIT=0 | Tüm yeni rota ve sayfalar derlendi. ESLint ile paralel çalıştırılmadı (bellek) |
| Canlı sunucu (`0.0.0.0:3000`, güncel derleme) | DOĞRULANDI | `/` 307; `/yonetim/*` oturumsuz → giriş yönlendirmesi; yeni GET API'ler oturumsuz → 401 `UNAUTHENTICATED`; yabancı Origin ile POST → 403 `CSRF_REJECTED` |
| Geliştirme DB migrasyonları | DOĞRULANDI | `prisma migrate status`: güncel |
| Tarayıcıda UI etkileşim testi | **DOĞRULANMADI** | Formlar, kullanıcı seçici, sayfalama bağlantıları ve PDF indirme tarayıcıda çalıştırılmadı |
| Bekletmede imha için HTTP 409 yanıtı | **DOĞRULANMADI** (HTTP) | Servis düzeyinde (`governance.test.ts`) DOĞRULANDI; HTTP düzeyi test edilmedi |

## 5. Bilinen sınırlar ve açık kararlar

- **Saklama süreleri (R-RET-01)**: Kodda sabit süre yok. Profil değerleri hukuk onayı bekler; onaylanmamış profil imha edilmez; arayüzde "politika bekliyor" olarak gösterilir. Süreler hukuk birimi tarafından girilmelidir; uydurulmamıştır.
- **Mali yıl sonu**: Harita girilmeyen yıl için başlangıç çözülmez; uyarı olarak görünür. Yıl sonu tarihleri kurum tarafından girilir.
- **Embedding**: Şemada embedding tablosu yok (doğrulandı). İmha "arama dizini" olarak `searchText` boşaltmasını yapar. Ayrı bir embedding deposu eklenirse yürütücüye aynı kapsamda silme eklenmelidir.
- **Engelleyici modda onay görevi**: Açık onay görevi olan ayrılış dosyası tamamlanamaz ve feragat edilemez. Tek çıkış sorumluluk devri veya dosya iptalidir. Devir, `document.approve` yetkisi ister; bu, uçtan uca HTTP testinde kurulmadı (servis düzeyinde yetki kontrolü kodda mevcut).
- **Ayrılış iptali ve devirler**: İptal, o zamana kadar yapılmış devirleri geri almaz; devredilen görev yeni sahibinde kalır.
- **Kırılma-cam listesi**: Sayfa başına 50 kayıt; önceki/sonraki bağlantıları ile gezinilir.
- **Sunucu**: `next start` uyarısı: `output: standalone` yapılandırmasında `node .next/standalone/server.js` önerilir. Çalışıyor; standalone dağıtımı ayrıca doğrulanmadı.
- **Yapılandırılmamış dış sistemler** "Bağlı" gösterilmez; `AUTH_MODE` tanımsızsa oturum kapısı giriş ekranına yönlendirir (sessiz düşüş yok). Geliştirme ortamında `AUTH_MODE=local`, `DATABASE_URL`, `STORAGE_ROOT` `apps/web/.env.local` içinde tanımlıdır; ClamAV (`CLAMD_HOST`) tanımlıdır ama bu turda taranmadı.

## 6. Yeni ve değişen API rotaları

- `POST /api/governance/retention-profiles`, `GET /api/governance/retention-profiles`, `PATCH /api/governance/retention-profiles/[id]`, `POST .../[id]/verify`
- `GET|POST /api/governance/fiscal-year-ends` (config.manage)
- `GET|POST /api/documents/[id]/retention`, `POST /api/documents/[id]/trigger-events`
- `GET|POST /api/documents/[id]/legal-holds`, `POST /api/legal-holds/[id]/release`
- `GET /api/disposal/queue`, `GET /api/disposal/executed` (config.manage), `POST /api/disposal/reviews/[id]/decision`, `GET /api/disposal/reviews/[id]/certificate` (PDF, config.manage), `POST /api/disposal/scan`, `POST /api/disposal/worker` (config.manage)
- `GET|POST /api/offboarding` (GET: `?status=OPEN|COMPLETED|CANCELLED`), `GET /api/offboarding/[id]`, `POST /api/offboarding/[id]/items/[itemId]`, `POST /api/offboarding/[id]/complete`, `POST /api/offboarding/[id]/cancel`
- `GET /api/users/picker?q=` (user.manage; yalnız aktif hesaplar)
- `POST /api/breakglass`, `GET /api/breakglass?page=` (`{items, hasMore, page}`), `POST /api/breakglass/[id]` (approve | reject | revoke)
- `GET /api/audit/evidence-pack?from&to[&departmentId][&documentId]`, `GET /api/audit/events?from&to[...]`

## 7. Sonraki adımlar

1. Tarayıcıda UI kabul testi: mali yıl formu, ayrılış listesi/seçici/iptal, kırılma-cam sayfalama, tutanak PDF indirme, denetim filtreleri.
2. Bekletmede imha ve devir yetkisinin HTTP düzeyinde testi (409 yanıtları, `document.approve` gerektiren devir).
3. Hukuk biriminin saklama profillerini onaylaması (R-RET-01) — kod tarafında bekleyen tek iş kalemi.
4. Standalone sunucu dağıtımının doğrulanması.

## 7. Ek doğrulama (sonraki tur)

| Kontrol | Durum | Kanıt |
|---|---|---|
| Şema sapma kontrolü (`prisma migrate diff --from-url <migrasyonlu DB> --to-schema-datamodel`) | DOĞRULANDI | `packages/db/src/schema-drift.test.ts`. İlk çalıştırmada gerçek sapmalar bulundu ve düzeltildi: `RetentionProfile.disposalApproverIds` varsayılanı (`@default([])`), `OffboardingItem` benzersizlik adı (`map: "ekos_offb_item_unique"`), `OCRJob` indeksi (`map: "ekos_ocr_queue_idx"`). Migrasyon eklenmedi; DB zaten doğru durumdaydı. |
| SQL-yönetimli nesneler | DOĞRULANDI (bilinçli istisna) | Üretilmiş `Document.searchVector` kolonu ve GIN/trigram indeksleri Prisma şemasında ifade edilemez; testte gerekçeleriyle listelenir. Liste dışındaki her fark testi başarısız yapar. |
| `APPROVAL_TASK` ayrılış testi | DOĞRULANDI | `faz4-closeout.test.ts`, engelleyici mod ve iptal çıkışı |
| Oturumlu HTTP rota testleri | DOĞRULANDI | `apps/web/tests/faz4-routes.test.ts` 7/7 |
| Tam vitest seti | DOĞRULANDI | 35 dosya, 394 test, hepsi geçti |
| Bekletmede imha → HTTP 409 | **DOĞRULANMADI** (HTTP) | Servis düzeyinde doğrulandı; HTTP düzeyi için bekletme + inceleme + karar zinciri gerekir, henüz yazılmadı |
| Tarayıcıda UI etkileşim testi | **DOĞRULANMADI** | Playwright E2E henüz yazılmadı |
