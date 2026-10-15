# Mimari Kararlar (ADR)

## Şablon

```
## ADR-XXXX — Başlık
- Durum: ÖNERİLDİ | KABUL EDİLDİ | DEĞİŞTİRİLDİ (ADR-YYYY ile) | REDDEDİLDİ
- Tarih: YYYY-MM-DD
- Bağlam: Hangi problem/kısıt?
- Karar: Ne seçildi?
- Gerekçe: Neden? Hangi alternatifler elendi?
- Sonuçlar: Olumlu/olumsuz etkiler, takip gereksinimleri.
```

---

## ADR-0001 — pnpm workspaces ile modüler monolit

- Durum: KABUL EDİLDİ · Tarih: 2026-10-13
- Bağlam: Tek ekip, tek ürün, sözleşme/belge/denetim arasında sıkı tutarlılık gerekiyor. Ayrı servisler dağıtık işlem ve yetki senkronizasyonu sorunları yaratır.
- Karar: Tek depo, pnpm workspaces; `apps/web`, `apps/worker`, `packages/{core,db,adapters}`. Mikroservis yok.
- Gerekçe: İş kuralları tek yerde (`core`) olduğu için yetki ve durum tutarlılığı tek transaction sınırı altında sağlanır. Sınır ayrımı paket düzeyinde zorlanır.
- Sonuçlar: Sınır ihlallerini önlemek için bağımlılık kuralları (ARCHITECTURE §2.1) Faz 1'de lint kuralıyla zorlanacak.

## ADR-0002 — Yığın (Next.js App Router, Prisma, PostgreSQL, BullMQ/Redis, S3 uyumlu depolama)

- Durum: KABUL EDİLDİ · Tarih: 2026-10-13
- Bağlam: Ekip TypeScript'te; tam yığın tek dilde olmalı; ilişkisel + tam metin arama gerekli.
- Karar: Değişmez yığın A4 ile aynıdır. Next.js (App Router) + React, Tailwind + shadcn/ui, TanStack Table, react-hook-form + zod, Prisma (çok dosyalı şema), PostgreSQL 16, BullMQ + Redis, S3 uyumlu depolama (geliştirmede MinIO).
- Gerekçe: Olgun ekosistem, parametrik sorgu ve tam metin desteği, kuyruk ayrımı worker'da yapılabilir.
- Sonuçlar: Prisma'nın tam metin için ham SQL gereksinimi `search_vector` migration'larında ele alınacak.

## ADR-0003 — Kimlik: Auth.js, açık mod seçimi, yerel moda sessiz düşüş yok

- Durum: KABUL EDİLDİ · Tarih: 2026-10-13
- Bağlam: Kurumsal SSO (Entra ID) ile yerel geliştirme/acil durum modu gerekir; yanlış düşüş güvenlik açığıdır.
- Karar: `AUTH_MODE=oidc|local`, varsayılan yok. `oidc`te yerel parola kapalı. `local`de argon2id, kilitleme, rate limit, TOTP; üretimde yalnızca açık ayarla; SSO yoksa kalıcı uyarı.
- Gerekçe: Kimlik modunun görünürlüğü ve açık seçimi, yanlış yapılandırmanın etkisini sınırlar.
- Sonuçlar: Faz 1'de Entra ID yapılandırması için tenant bilgisi gerekir (yapılandırma engeli).

## ADR-0004 — Kimlik ve numara stratejisi (UUIDv7 + insan okunur numara)

- Durum: KABUL EDİLDİ · Tarih: 2026-10-13
- Bağlam: Sıralanabilir ve dağıtık üretilebilir kimlik; kullanıcıya gösterilecek kısa, okunur numara.
- Karar: İç kimlik UUIDv7 (değişmez). Numara `EKOS-{TÜRKODU}-{YIL}-{6 hane}`, tür+yıl bazlı veritabanı sayacı, işlem içinde.
- Gerekçe: UUIDv7 indeks yerelliği sağlar; sayaç çakışmasız numara üretir.
- Sonuçlar: Sayaç için `SELECT ... FOR UPDATE` veya eşdeğer kilit Faz 0b/1'de test edilecek.

## ADR-0005 — Zaman ve para

- Durum: KABUL EDİLDİ · Tarih: 2026-10-13
- Bağlam: Çok tarih dilimi ve çok para birimi; float hataları kabul edilemez.
- Karar: Zaman damgaları UTC `timestamptz`. Sözleşme tarihleri `DATE` (saat dilimsiz, `@db.Date`). Arayüz Europe/Istanbul gösterir. Para `NUMERIC(19,4)` + ISO 4217; JS'te `decimal.js`; float yasak.
- Gerekçe: Tarih-yalnızca anlamı dilim kaymasından etkilenmez; para tam hassasiyet ister.
- Sonuçlar: Ayrı `packages/core/src/dates` modülü; iş günü hesabı tatil takvimi yapılandırılmadan desteklenmez.

## ADR-0006 — Eşzamanlılık: `rowVersion` ve 409

- Durum: KABUL EDİLDİ · Tarih: 2026-10-13
- Bağlam: Çok kullanıcılı düzenleme; sessiz üzerine yazma kabul edilemez.
- Karar: Ana kayıtlarda `rowVersion`; güncelleme beklenen sürümü gönderir; uyuşmazlıkta 409. Kritik POST'lar `Idempotency-Key` kabul eder.
- Gerekçe: İyimser kilit, ölçeklenebilir ve test edilebilir.

## ADR-0007 — Denetim izi: INSERT-yalnız tablo ve SHA-256 zinciri

- Durum: KABUL EDİLDİ · Tarih: 2026-10-13
- Bağlam: Denetim kayıtlarının sonradan değiştirilmesi tespit edilmelidir.
- Karar: Tek `AuditEvent` tablosu. Uygulama rolü yalnızca INSERT yapar; veritabanı tetikleyicisi UPDATE/DELETE'i reddeder. Her olay önceki olayın özetini içeren SHA-256 zinciri taşır; doğrulama komutu vardır.
- Gerekçe: Zincir yalnızca **tahrifat tespiti** sağlar. Değiştirilemezlik sertifikası değildir; README bunu açıkça belirtir. Belge içeriği, OCR metni, parola ve token audit'e yazılmaz.
- Sonuçlar: Hukuki geçerlilik değerlendirmesi için "Hukuk/Veri Koruma incelemesi gerekir".

## ADR-0008 — Arama: PostgreSQL tam metin + pg_trgm + unaccent, Türkçe normalizasyon

- Durum: KABUL EDİLDİ · Tarih: 2026-10-13
- Bağlam: Türkçe büyük/küçük harf (İ/i, I/ı) ve ASCII katlama (ş, ğ, ü, ö, ç, ı) kuralları varsayılan PostgreSQL yapılandırmasıyla doğru çalışmaz.
- Karar: Orijinal metadata değişmez; ayrı `search_text` sütunu; ortak `normalizeTr` fonksiyonu hem yazmada hem sorguda kullanılır. Tırnaklı "tam ifade" ve "geniş" arama ayrımı. İmleç tabanlı sayfalama.
- Gerekçe: Tek normalizasyon fonksiyonu yazma/sorgu asimetrisini önler.
- Sonuçlar: `normalizeTr` birim testleri (İ→i, I→ı, ş, ğ, ü, ö, ç) Faz 2'de zorunlu.

## ADR-0009 — Yetki modeli: tek `authorize()`, deny-by-default, 403/404 ayrımı

- Durum: KABUL EDİLDİ · Tarih: 2026-10-13
- Bağlam: Yetki kararları dağınık olursa IDOR ve sızıntı kaçınılmazdır.
- Karar: Tek fonksiyon `packages/core`'da; her uç nokta ve worker görevi çağırır. Varsayılan red. DENY önceliklidir. Görmesi yasak kaynak 404, görebildiği ama eylemi olmayan kaynak 403.
- Gerekçe: Tek doğrulayıcı, test edilebilir ve denetlenebilir. Deny-by-default, yeni uç noktanın yanlışlıkla açık kalmasını önler.
- Sonuçlar: Sarmalayıcısız route'u yakalayan otomatik test Faz 1'de zorunlu.

## ADR-0010 — Yaşam döngüsü: iki eksen, açık geçiş tabloları, bekletme bayraktır

- Durum: KABUL EDİLDİ · Tarih: 2026-10-13
- Bağlam: Belge işleme (teknik) ve iş yaşam döngüsü (onay/imza) farklı şeylerdir; karıştırılırsa "yayımlanmış" yanlış anlaşılır.
- Karar: `ingestStatus` ve `lifecycleStatus` ayrı eksenler. Geçişler `packages/core`'da tablo. Hukuki bekletme durum değil bayraktır.
- Gerekçe: Tablo tabanlı geçişler denetlenebilir; bayrak, bekletmenin her durumda geçerli olmasını sağlar.

## ADR-0011 — `integration.manage` izni yalnızca Platform Yöneticisi rolüne verilir

- Durum: KABUL EDİLDİ (karar, A4'te açıkça listelenmemiş) · Tarih: 2026-10-13
- Bağlam: A4 platform yöneticisine `user.manage`, `role.manage`, `config.manage`, `system.health` atar. Entegrasyon kimlik bilgilerinin yönetimi bu kümenin doğal bir parçasıdır ve içerik izni değildir.
- Karar: `integration.manage` yalnızca Platform Yöneticisi'ndedir. İçerik izinleri ile karışmaz.
- Gerekçe: Entegrasyon yapılandırması veri akışını (ve dolayısıyla içeriği) etkileyebildiği için en az ayrıcalık; ancak belge içeriğine doğrudan erişim vermez.
- Sonuçlar: Kurum farklı bir sorumlu isterse bu ADR değiştirilir. **Hukuk/Güvenlik onayı gerekir.**

## ADR-0012 — Faz 0 iki alt faza bölündü (0a / 0b)

- Durum: KABUL EDİLDİ · Tarih: 2026-10-13
- Bağlam: Faz 0 tek çıktıda ~60 Prisma modeli, tüm mimari dokümanlar, Docker, CI ve test kurulumu içeriyordu. Tek çıktıda üretim uzunluk sınırına takılma ve tutarsızlık riski yüksekti.
- Karar: **0a**: monorepo iskeleti, dokümanlar, izin kataloğu, durum tipleri, Docker/CI, minimal web/worker. **0b**: Prisma şeması, ilk migration, şema-durum tutarlılık testleri.
- Gerekçe: Her alt faz kendi kabul kriterine sahip olur; 0b şemayı 0a'nın doğrulanmış iskeleti üzerinde test eder.
- Sonuçlar: `vitest.config.ts` içindeki `passWithNoTests` geçici bir ayardır; Faz 1'de kaldırılacak.

## ADR-0013 — Gemini/AI sağlayıcısı varsayılan kapalı

- Durum: KABUL EDİLDİ · Tarih: 2026-10-13
- Bağlam: Belge içeriğinin dış AI'ya gönderilmesi veri koruma riski taşır.
- Karar: `AiProvider` varsayılan `NOT_CONFIGURED`. Gönderim yalnızca yönetici sağlayıcı, veri işleme onayı, veri yerleşimi yapılandırmış ve belge türü bazında açmışsa. AI kapalıyken çekirdek işlevler çalışır.
- Gerekçe: En az veri gönderimi; yapılandırılmamış hiçbir dış sistem varsayılan olarak aktif değildir.
- Sonuçlar: Faz 6. **Hukuk/Veri Koruma incelemesi gerekir.**

## ADR-0014 — Denetim ve kullanıcı referansları FK değil, yalnızca skaler kimlik

- Durum: KABUL EDİLDİ · Tarih: 2026-10-13 (Faz 0b)
- Bağlam: `createdBy/updatedBy`, `actorId`, `approverId` gibi alanların her biri `User`'a FK olsaydı, ilişki sayısı artar ve denetim kaydı kullanıcı silinmesine bağımlı olurdu.
- Karar: Denetim/özne alanları skaler `UUID` olarak tutulur (FK yok). Kullanıcılar fiziksel olarak silinmez (`status=DISABLED|OFFBOARDING`), bu nedenle kimlik her zaman çözülebilir kalır. **Sahiplik ve üyelik ilişkileri** (Membership, GroupMember, Delegation, ApprovalTask.assignee, NotificationPreference, BreakGlassGrant) FK'dır.
- Gerekçe: Denetim kaydı, aktörün sonraki yaşam döngüsünden bağımsız olmalı; FK zinciri de gereksiz kilitlenme yaratır.
- Sonuçlar: Skaler kimliklerin varlığı uygulama katmanında doğrulanır (Faz 1). **Hukuk/İK onayı gerekir**: ayrılan çalışanların kayıtlarının tutulma süresi.

## ADR-0015 — Prisma'nın ifade edemediği kısıtlar el yazımı migration'da (0002)

- Durum: KABUL EDİLDİ · Tarih: 2026-10-13 (Faz 0b)
- Bağlam: Prisma CHECK kısıtlarını, tetikleyicileri, üretilen (generated) kolonları ve `REVOKE` komutlarını desteklemez; `@@check` yoktur.
- Karar: `prisma migrate diff` çıktısı `0001_init` olarak alınır; ek koruma ve kısıtlar `0002_db_guards` içinde el yazımı SQL olarak bulunur. Sıra değiştirilmez. Kısıt/tetikleyici adları `ekos_` önekiyle başlar.
- Gerekçe: Veri bütünlüğünün son savunma hattı veritabanındadır; uygulama hatası da yakalanır.
- Sonuçlar: `prisma migrate dev` ileride `0002` ile ilgili "drift" uyarısı verebilir (generated `searchVector` ve tetikleyiciler Prisma şemasında yoktur). Geliştirme ortamında bu uyarılar bilinen ve beklenen durumdur. **Faz 1'de** `migrate deploy` yolu tek resmi yol olarak kullanılacak.

## ADR-0016 — Şema testleri: statik kontrol + gerçek Postgres motoru (PGlite)

- Durum: KABUL EDİLDİ · Tarih: 2026-10-13 (Faz 0b)
- Bağlam: Docker bu geliştirme ortamında yok; yine de migration SQL'inin gerçekten çalıştığı ve korumaların davrandığı kanıtlanmalıydı.
- Karar: `packages/db/src/migrations.test.ts` migration'ları `@electric-sql/pglite` (PostgreSQL'in WASM derlemesi, gerçek motor) üzerinde çalıştırır ve trigger/CHECK/RESTRICT davranışlarını dener. `schema.test.ts` Prisma dosyalarını metin olarak denetler (UUIDv7, Decimal, `@db.Date`, `onDelete` kuralı, enum eşitliği core ile).
- Sınır: PGlite'te `unaccent` eklentisi yoktur; testte yalnızca o `CREATE EXTENSION` satırı atlanır. **unaccent gerçek PostgreSQL 16'da DOĞRULANMADI.** Üretim öncesi `pnpm db:migrate` (docker compose ile) ve bir gerçek PG üzerinde test çalıştırılmalıdır.
- Sınır 2: PGlite ile gerçek PG aynı değildir; süper kullanıcı tetikleyiciyi devre dışı bırakabilir. Denetim izinin dış tahrifata karşı güvencesi için DB rol ayrımı ve yedekleme/ayrı hesap kontrolü Faz 1 ve Faz 7'de ele alınır.
