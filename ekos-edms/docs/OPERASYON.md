# EKOS EDMS — Kurulum ve Operasyon Kılavuzu (Faz 7)

> Durum: **taslak, agent tarafından yazıldı.** Sonuçlar için `docs/FAZ7_DURUM.md` esas alınmalıdır. Bu belge hiçbir RPO/RTO değeri vermez; bu değerler şirketçe onaylanmamıştır.

## 1. Ön koşullar

- Node.js 20 LTS, pnpm 9.12.0 (`npx --yes pnpm@9.12.0 ...`).
- PostgreSQL 16 (uygulama rolü: yalnız gerekli yetkiler; denetim tablosu INSERT-yalnız).
- Mutlak yol olan bir `STORAGE_ROOT` dizini (uygulama dışından erişilemez).
- ClamAV (clamd) — yoksa yüklenen dosyalar taranamaz ve **kullanılamaz** (karantinada kalır).
- Yalnız geliştirme için: `packages/db/scripts/pg-dev.mjs` (port 54330).

## 2. Yapılandırma

Şablon: `.env.example`. **Gerçek değer dosyaya yazılmaz**; secret manager veya sunucu ortamından okunur.

Uygulama başlangıcında `apps/web/instrumentation.ts` yapılandırmayı doğrular:

- `ERROR` varsa uygulama **başlamaz** (ör. üretimde `AUTH_MODE` seçilmemişse, `DATABASE_URL` eksikse, bilinen geliştirme parolası kullanılıyorsa, e-imza kısmi yapılandırılmışsa, `EKOS_DEV_PASSWORD` üretimde tanımlıysa).
- `WARNING` uygulamayı durdurmaz, günlüğe yazılır (ör. ClamAV yapılandırılmamış).
- Hata mesajları değer içermez; yalnız anahtar adı ve kural kodu.

Yapılandırılabilir limitler (varsayılanlar ve aralıklar):

| Değişken | Varsayılan | Aralık |
|---|---|---|
| `MAX_UPLOAD_MB` | 50 | 1–200 |
| `MAX_MANIFEST_MB` | 5 | 1–50 |
| `SEARCH_PAGE_MAX` | 100 | 10–500 |
| `JOBS_INTERVAL_SECONDS` | 300 | 30–86400 |
| `ESIGN_TIMEOUT_MS` | 30000 | 1000–120000 |
| `CLAMD_TIMEOUT_MS` | 60000 | 1000–300000 |

Aralık dışı değer **sessizce düzeltilmez**; ERROR olur.

## 3. Migration prosedürü

- Migration'lar `packages/db/prisma/migrations/` altında ileri yönlüdür (`prisma migrate deploy`).
- **Üretimde veri silen/sıfırlayan komut kullanılmaz.** Yasaklı: `prisma migrate reset`, `prisma db push --force-reset`, `--accept-data-loss`, `DROP DATABASE/SCHEMA`, `TRUNCATE`, `DELETE FROM`, `DROP TABLE/COLUMN`. Bu kural `security.test.ts` tarafından otomatik denetlenir.
- Denetim tablosu (`AuditEvent`) UPDATE/DELETE/TRUNCATE tetikleyicileriyle korunur (0002 migration).
- Şema-tutarlılık denetimi: `packages/db/src/schema-drift.test.ts`.

## 4. Yedekleme ve geri yükleme (mantıksal)

Araç: `packages/db/scripts/backup.ts` (Node tabanlı; `pg_dump` gerektirmez).

```bash
cd packages/db
DATABASE_URL=... npx tsx scripts/backup.ts export /güvenli/yedek/2026-10-15   # NDJSON + SHA-256 manifest
DATABASE_URL=... npx tsx scripts/backup.ts verify /güvenli/yedek/2026-10-15   # dosya bütünlüğü
DATABASE_URL=... npx tsx scripts/backup.ts import /güvenli/yedek/2026-10-15   # yalnız BOŞ hedef DB
```

Garantiler (testli: `packages/db/src/ops/backup.test.ts`, gerçek PostgreSQL):

- Geri yükleme yalnız boş veritabanına ve aynı `lastMigration` değerine izin verir; aksi halde reddeder.
- Tek transaction; yazım sonrası özet (digest) eşitliği doğrulanır.
- Bozulmuş dosya tespit edilir (SHA-256).

**Sınırlar (önemli):**
- Bu bir **mantıksal** yedektir; dosya deposu (`STORAGE_ROOT`) içeriğini kapsamaz. Dosya yedeği ayrıca alınmalıdır.
- Yedek dosyaları kişisel veri içerir; şifreli ve erişimi kısıtlı bir ortamda saklanmalıdır.
- **RPO/RTO değerleri tanımlı değildir ve hiçbir değer taahhüt edilmez.** Bunlar kurum tarafından onaylanmalıdır.
- Gerçek üretim-benzeri dizin üzerinde uçtan uca geri yükleme tatbikatı henüz yapılmamıştır.

## 5. Uyarılar

`packages/db/src/ops/alerts.ts` denetim olaylarını eşiklere göre değerlendirir (varsayılan kurallar: AUTH_FAILURE_BURST, ACCOUNT_LOCKOUT, ACCESS_DENIED_BURST, BREAK_GLASS_ACTIVITY, MALWARE_DETECTED). Çıktı yalnız kural kodu ve sayılardır; PII içermez. **Bildirim kanalı (e-posta/SIEM) henüz bağlı değildir.**

## 6. Sorun giderme

| Belirti | Olası neden | Yapılacak |
|---|---|---|
| Uygulama başlamıyor, `Yapılandırma hatası` | ERROR kuralı | Log'daki anahtar:kod çiftine bakın; §2 |
| Yüklenen dosya "kullanılamaz" | ClamAV yok/erişilemiyor veya dosya karantinada | `CLAMD_HOST`, ağ erişimi; tarama durumunu kontrol edin |
| Sözleşme ACTIVE olmuyor | İmzalı sürüm taraması CLEAN değil ya da imza kanıtı yok | Belge tarama durumu ve kanıt kaydı |
| `VERSION_CONFLICT` | Eşzamanlı değişiklik | Kaydı yenileyip tekrar deneyin |
| Geri yükleme reddediliyor | Hedef DB boş değil veya migration sürümü farklı | Boş DB ve aynı migration ile tekrar deneyin |
| `pnpm lint` bellek hatası | Tam repo ESLint | `node scripts/lint.mjs` (paket bazında) |

## 7. Test komutları

```bash
npx vitest run                        # tüm testler (gerçek PostgreSQL gerektirir)
node scripts/lint.mjs                 # paket bazında lint
(cd packages/db && ../../node_modules/.bin/tsc --noEmit -p tsconfig.json)   # core, adapters, apps/web için de
(cd apps/web && ./node_modules/.bin/next build --no-lint)                    # üretim derlemesi + sahte veri taraması
npx --yes pnpm@9.12.0 audit           # bağımlılık açıkları
npx --yes pnpm@9.12.0 audit --prod    # yalnız üretim bağımlılıkları
```

E2E (`pnpm e2e`) için `e2e/README.md` ön koşullarını izleyin. **Faz 7 E2E senaryoları henüz yazılmamıştır.**

## 8. Admin kontrol listesi (go-live öncesi)

Her madde bir sorumlu ve tarih ile işaretlenmelidir. Agent bu maddeleri **tamamlamış değildir**.

- [ ] Hukuk onayı: A5/5 varsayımı, saklama süreleri, e-imza geçerliliği
- [ ] Mali işler onayı: maliyet/lisans (ClamAV, e-imza sağlayıcı, AI)
- [ ] İK onayı: personel ayrılışı, rol atamaları, görevlendirme süreçleri
- [ ] Veri koruma onayı: kişisel veri envanteri, yedek şifreleme, saklama ve imha
- [ ] Gerçek veriyle kabul testi (sahte veri kullanılmadı)
- [ ] Kurumsal SSO (OIDC) canlı testi ve e-imza/SMTP/ClamAV canlı testleri
- [ ] Yedekleme tatbikatı ve RPO/RTO değerlerinin kurumca onaylanması
- [ ] Container imajı derlemesi ve güvenlik taraması
- [ ] Uyarı kanalının bağlanması ve nöbet sorumlusu
- [ ] `docs/FAZ7_DURUM.md` açık maddelerinin kapatılması
