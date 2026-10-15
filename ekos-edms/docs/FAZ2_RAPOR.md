# Faz 2 Raporu — EKOS EDMS

Tarih: 2026-10-13. Durum: **Faz 2 eksikleri kapatıldı; kullanıcı onayı bekleniyor. Faz 3'e geçilmedi.**

Etiketler: **DOĞRULANDI** = bu ortamda çalıştırıldı ve sonuç gözlendi. **KISMEN** = bir kısmı doğrulandı. **DOĞRULANMADI** = çalıştırılmadı ya da ortam nedeniyle yapılamadı.

## 1. Ortam sınırları (önemli)

- Sandbox belleği 2 GB. ClamAV `clamd` (~0,7–1 GB RSS) ile Next dev sunucusu aynı anda çalıştığında çekirdek OOM killer clamd'yi öldürdü (üç kez). Bu bir ürün hatası değil, geliştirme ortamının kapasitesi.
- Şu an clamd **çalışmıyor**. Bu durumda yükleme `scan: UNAVAILABLE` döner ve dosya karantinada kalır; belge `READY` olmaz. Bu, A4 kuralına uygun doğru davranıştır.
- Tarayıcı kurulu değil; görsel (piksel) kontrolü **DOĞRULANMADI**. Sunucu tarafı HTML içerikleri ve HTTP durumları doğrulandı.

## 2. Doğrulama özeti

| Kontrol | Sonuç |
|---|---|
| `apps/web` ESLint + `packages/db` ESLint | DOĞRULANDI — 0 hata |
| `apps/web` tsc, `packages/db` tsc, `packages/db/scripts` tsc | DOĞRULANDI — 0 hata |
| Kök `vitest run` (tüm paketler) | DOĞRULANDI — 21 dosya, 260 test, geçti, atlanan yok |
| `next build` (apps/web) | DOĞRULANDI — başarılı, 27 rota |
| Prisma `validate` / `generate` / `migrate deploy` (0007, 0008) | DOĞRULANDI |
| Gerçek clamd: temiz PDF → `CLEAN` | DOĞRULANDI (HTTP yükleme 201, scan CLEAN) |
| Gerçek clamd: tam EICAR baytları → `INFECTED` | DOĞRULANDI (`scanFile`, dosya karantinada kaldı, `FILE_SCAN_INFECTED` audit) |
| Gerçek OCR: PNG → clamd CLEAN → OCR kuyruğu → tesseract → `READY` ve `searchText` | DOĞRULANDI (OCR metni arama metnine girdi) |
| Dosya havuzu + manifest (gerçek clamd) | DOĞRULANDI (havuz 2× CLEAN; manifest 1 OK + 4 satır hatası) |
| TOTP: kurulum, onay, TOTP_REQUIRED, yanlış kod sayacı, replay engeli | DOĞRULANDI (HTTP + 10 birim test) |
| Giriş IP hız sınırı (30 deneme / 15 dk) | DOĞRULANDI (31. istek 429 + Retry-After 900) |
| TOTP kurtarma CLI (`reset-totp.ts`) | DOĞRULANDI (sıfırlama + `TOTP_RESET_CLI` audit) |
| Yetki: oturumsuz 401, same-origin yok 403, rol bazlı 403, birim dışı belge 404 | DOĞRULANDI |
| Kopya uyarısı kapsam sızıntısı | DOĞRULANDI — birim kullanıcısı, aynı içerikli 5 belgeyi CM'ye görünürken **görmedi** (`duplicates: []`) |
| Retention profilleri (7, "politika bekliyor") + tür bağlantısı | DOĞRULANDI (15/15 tür aktif, 7 profil bekliyor; 5 birim test) |
| Ekran render (HTTP): giriş, güvenlik, karşı taraflar, yüklemeler, ice-aktarım, belge detayı (sürüm geçmişi) | DOĞRULANDI (HTTP 200 + beklenen içerik; yetkisizlere "yetkiniz yok") |
| Tarayıcıda görsel kontrol | DOĞRULANMADI (tarayıcı kurulu değil) |

## 3. Bu turda tamamlananlar

**Saklama süreleri (R-RET-01)**
- Migration `0008_retention_policy_pending`: `startEvent` ve `disposalMethod` boş olabilir. DB CHECK: `verifiedByLegal = true` ise ikisi zorunlu.
- `seed-data/retention-profiles.json` (7 profil) doğrulamalı yüklenir. Değer uydurulmaz; süre, başlangıç olayı ve imha null; `basisNote` "Politika bekliyor" der.
- Tür bağlantısı: profili bağlı türler aktif, bağlı olmayan türler pasif.
- **Eksik:** otomatik imha işlemi kodlanmadı. Profiller onaylanmadığı için zaten bir imha tetiklenmez, ama imha modülü Faz 4/5 kapsamındadır.

**TOTP (Faz 1 tamamlayıcısı)**
- `POST /api/auth/totp/enroll` ve `/confirm` (oturum + same-origin).
- Giriş: `TOTP_REQUIRED` → 401 (sayaç artmaz); `TOTP_NOT_CONFIGURED` → 503.
- Giriş formunda kod alanı; `/yonetim/guvenlik` ekranında kurulum (QR + gizli anahtar).
- `TOTP_ENCRYPTION_KEY` yoksa kurulum kapalı, açık mesaj.
- Kurtarma: `packages/db/scripts/reset-totp.ts` (CLI, denetim kaydı).
- Hız sınırı: IP başına bellek içi sayaç. **Sınır:** tek süreç. Ters vekil arkasında olmalı; `X-Forwarded-For` yalnızca güvenilen vekil tarafından yazılmalı.

**Karşı taraf**
- Servis (`createCounterparty`, `listActiveCounterparties`), `GET/POST /api/counterparties`, `/yonetim/karsi-taraflar`.
- `counterparty.manage` yalnız CONTRACT_MANAGER rolünde (PERMISSIONS.md). Platform yöneticisi 403 alır; bu tasarım gereğidir.
- REFERENCE metadata: `counterpartyId` varlık + aktiflik; `parentDocumentId` varlık. Eskiden hiç doğrulanmıyordu.

**Yükleme**
- Formda tür-bağımlı alanlar: karşı taraf, tutar, para birimi, birim (çoklu birimli kullanıcı için zorunlu).
- Eskiden `PURCHASE_ORDER` gibi türler, formda gösterilmeyen zorunlu alanlar (karşı taraf, tutar, para birimi) yüzünden arayüzden yüklenemiyordu. Artık form türün zorunlu alanlarını gösterir.
- Kopya uyarısı: yanıtta `duplicates` (yalnız görülebilen belgeler, en fazla 5), formda uyarı kutusu.
- **Eksik:** metadata benzerliği uyarısı yok. Spec "yalnız uyarı" diyor; ayrı zayıf sinyal olarak ertelendi.

**Sürüm geçmişi**
- Belge detayında sürüm tablosu: sürüm no, dosya, tarama, SHA-256 öneki, tarih, durum (güncel / yerine geçildi / imzalı kilitli).

**Düzeltilen yetki ve güvenlik hataları (bu turda bulundu)**
1. **Kullanıcı oluşturma kapsamı boş bırakıyordu.** PERMISSIONS.md'ye göre boş kapsam = kısıt yok. `DEPARTMENT_USER` gibi kapsamlı rol, kapsam girilmeden kurum genelinde erişim alıyordu. Düzeltme: kapsam verilmeden kapsamlı rol oluşturulamaz; kurum geneli için `EKOS_ORGANIZATION_WIDE=yes` açıkça gerekir.
2. **Kaynaksız `authorize` kapsamlı kullanıcıyı reddediyordu.** Yükleme ekranı, yükleme API'si, karşı taraf listesi ve manifest, birim kapsamlı kullanıcılar için çalışmıyordu. Düzeltme: yükleme artık hedef belgenin birim/tür/karşı taraf bilgisiyle yetki kontrol eder; referans listeleri için aktif üyelik kontrolü (`hasActiveGrant`) kullanılır.
3. **Toplu içe aktarma yetki yükseltmesi riski.** Manifest satır başına birden çok belge oluşturur, satır bazlı kapsam denetimi yok. Yalnız kurum geneli yükleme yetkisi olanlara açıldı (kapsamlı kullanıcı 403 + gerekçe). Dosya havuzu belge oluşturmaz; aktif yetkiyle açık.
4. Yükleme yanıtındaki birim: tek birimli kullanıcının belgesi kendi birimine atanır (eskiden `null`, kullanıcı kendi belgesini bile göremiyordu).

**Diğer**
- Login rotası ve TOTP rotaları için `apps/web/lib/server/grants.ts`, `rate-limit.ts`.
- `apps/web/.env.local` oluşturuldu (yalnız geliştirme; gitignore'da; rastgele secret'lar). Gerçek üretim değerleri secret manager'dan gelir.

## 4. Açık / bilinen sınırlar

- **16. belge türü:** orijinal listede adı yok; çalışma alanında 15 tür var. Kullanıcı kararı bekleniyor.
- **Metadata benzerliği uyarısı:** yok (yukarıda).
- **Yetim karantina nesnesi:** yükleme önce dosyayı kaydeder, sonra belgeyi oluşturur. Belge oluşturma başarısız olursa karantinada belgesiz bir nesne kalır. Görünmez ve kopya taramasına girmez; temizlik işi Faz 5'e.
- **Tarayıcı görünümü:** doğrulanmadı.
- **Clamd bu oturumda çalışmıyor** (sandbox belleği). Ürün ortamında ayrı süreç/konteyner olarak çalıştırılmalı.
- **Çoklu süreç:** hız sınırı ve bazı önbellekler tek süreçlidir.

## 5. Geliştirme hesapları ve test verisi (silinmeli)

Geliştirme veritabanında (127.0.0.1:54330/ekos_dev) test verisi var. Gerçek kullanımdan önce silinmeli:
- Kullanıcılar: `totp-test@ekos.local` (RECORDS_MANAGER), `cm-test@ekos.local` (CONTRACT_MANAGER), `dept-test@ekos.local` (DEPARTMENT_USER, "Test Birimi A"). Parola: `Test-Parola-2026-ekos`.
- Belgeler: "probe", "EICAR testi", "Temiz PDF", "PO kopya testi", "Birim kopya testi", "CM kopya", "Son duman testi" ve OCR testi belgeleri.
- Karşı taraflar: "ABC Lojistik Ltd. Şti. (test)", "ABC Tedarik A.Ş. (test)" (test), "Sözleşme Tedarik A.Ş. (test)".
- Yönetici (`yonetici@ekos.local`) TOTP'si test sırasında etkinleşti; kurtarma CLI ile sıfırlandı.

## 6. Kullanıcıya raporlanan önceki eksikler (düzeltme istenmedi)

- Faz 1 metnindeki "A9 listesi" referansı.
- Faz 0'daki "A5/Rol şablonları" eksikliği.
- "&amp;" başlık kalıntısı.
- Belge türü şablon sayısı 15 (istenen 16).

## 7. Onay

Faz 2 kabulü: "yetkili kullanıcı yükler, izler, arar; yetkisiz hiçbir yoldan göremez." Yükleme, izleme, arama, sürüm geçmişi ve kopya uyarısı doğrulandı. Yetkisiz erişim (birim dışı belge, kapsam dışı yükleme, manifest, karşı taraf yazımı) doğrulandı.

Onayınızı bekliyorum. Onaydan sonra Faz 3'e geçilecek.
