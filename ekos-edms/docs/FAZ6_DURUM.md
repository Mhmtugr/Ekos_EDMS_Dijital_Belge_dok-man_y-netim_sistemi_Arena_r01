# Faz 6 — Durum Raporu

Tarih: 2026-10-14 (Europe/Istanbul). Bu rapor yalnızca bu oturumda çalıştırılarak doğrulanmış ifadeleri içerir. Kullanıcı tarafında yeniden koşulmadığı için hiçbir satır `DOĞRULANDI` olarak işaretlenmemiştir (bkz. `TRACEABILITY.md` durum sözlüğü).

## Doğrulama çalıştırmaları

| Kontrol | Komut / yöntem | Sonuç |
|---|---|---|
| Kök birim/entegrasyon testleri | `npx vitest run` (kök) | 41 dosya, **477/477 geçti** |
| Adaptör + DB entegrasyon testleri | `vitest` (`packages/adapters`, `packages/db/src/integrations`) | 82/82 geçti (son kodla kök koşuya dahil) |
| Web API rota testleri | `apps/web/app/api/__tests__/faz6-routes.test.ts` | 7/7 geçti |
| Uçtan uca (Playwright, Chromium) | `e2e/faz5.spec.ts`, `e2e/faz6.spec.ts`, `e2e/sozlesme-akisi.spec.ts` | **31/31 geçti** (sunucu: `next build` + `next start`, port 3000) |
| Üretim derlemesi | `next build --no-lint` (apps/web) | başarılı |
| Tip denetimi | `tsc --noEmit` (packages/db, packages/adapters, apps/web) | 0 hata |
| Lint (paket bazında) | `eslint` — `packages/core`, `packages/adapters`, `packages/db`, `apps/web` (tümü), `apps/worker`, `e2e` | **0 hata, `--max-warnings=0`** |

Bilinen araç sınırı: tek süreçte `eslint .` (tüm repo) bellek nedeniyle sonlandırılıyor (exit 134/137, 12 GB bellek sınırıyla da). Bu nedenle lint paket bazında koşuldu; her paket/uygulama ayrı ayrı temizdir.

## Uygulanan kapsam

1. **Adaptör çerçevesi:** ortak arayüz; durumlar `NOT_CONFIGURED | CONFIGURED_UNVERIFIED | CONNECTED | FAILED`; `SyncRun` (kaynak sistem, senkron zamanı, dış kayıt ID); idempotent webhook; yeniden deneme ve hata kuyruğu; sistem sağlığı ekranı.
2. **Sağlayıcılar (kimlik bilgisi yoksa "Yapılandırılmadı"):**
   - Entra ID OIDC: state/nonce/PKCE tek kullanımlık; grup/rol eşlemesi (`IdentityProviderMapping`). Hata kodları: `IDP_DENIED`, `IDP_STATE`, `IDP_NO_EMAIL`, `IDP_FAILED`, `USER_NOT_PROVISIONED`, `USER_INACTIVE`. Yapılandırma yoksa 503 `IDP_NOT_CONFIGURED`. Kullanıcıya yalnız kısa kod döner; ayrıntı sunucu logunda `cid` ile.
   - SMTP/Graph e-posta, Teams webhook/Graph, SharePoint içe aktarımı, ERP/satın alma arayüzü: arayüz + `NOT_CONFIGURED`; gerçek ağ çağrısı yapılmadı, testler test double ile yapıldı ve **"mock entegrasyonla test"** olarak etiketlidir.
   - E-imza webhook'u: `ESIGN_WEBHOOK_SECRET` yoksa 503; imza geçersiz 401; eski zaman damgası 401 `TIMESTAMP_OUT_OF_RANGE`; tekrar gönderim 200 `DUPLICATE`; geçersiz gövde 409; bilinmeyen işlem 422 `TRANSACTION_UNKNOWN`; işlenen 200 `PROCESSED`.
3. **AI adaptörü (`AiProvider`):** Gemini API ve Vertex AI; varsayılan `NOT_CONFIGURED`. Çıkarım sonucu `ExtractionResult` (alan, değer, kaynak sayfa, metin aralığı, güven, durum). Kritik alanlar `VERIFIED` olmadan sözleşme alanına yazılmaz ve alarm üretmez. Yerel OCR öncelikli; dış AI'ya yalnızca onaylı belge türleri gönderilir.
4. **RAG soru-cevap (`/api/ai/ask`):** yetki filtresi SQL içinde ve retrieval'dan önce uygulanır; kaynak (belge adı, sayfa, kısa referans); üretim sonrası yetki yeniden doğrulaması; dayanak yoksa "Belgede doğrulanabilir bilgi bulunamadı." Yanıt `status`: `ANSWERED | NOT_FOUND | PASSAGES_ONLY`, `correlationId` içerir. 401 oturumsuz, 400 geçersiz gövde (500 karakter sınırı), 429 hız sınırı.
5. **Prompt-injection savunması:** belge metni veri bloğu olarak işlenir; AI çıktısı şemayla doğrulanır; AI'nın araç veya yazma erişimi yoktur; olay metaverisi audit'e yazılır, içerik yazılmaz.

## Test kapsamı (istenen senaryolar)

- "Yapılandırılmadı" davranışı: kimlik bilgisi yokken arayüz `Yapılandırılmadı` gösterir, sahte `Bağlı` yoktur (E2E `faz6`).
- Test double testleri: `mock entegrasyonla test` etiketli.
- Idempotent webhook: aynı olay ikinci kez `DUPLICATE`.
- AI kapalıyken çekirdek akış: sözleşme oluşturma/onay AI olmadan çalışır.
- Kritik alan doğrulaması olmadan alarm yok.
- Enjekte talimat sonucu değiştiremez.
- RAG'de kasıtlı yetkisiz belgeyle sızıntı yok: yetkisiz belgenin adı, varlığı, metni ve embedding'i yanıta girmez.

## Kararlar ve varsayımlar

- **A5/5 (AI açma koşulları) dokümanlarda tanımlı değil.** Geçici tasarım varsayımı: AI yalnızca `AI sağlayıcısı yapılandırılmış` + `AI_DATA_PROCESSING_APPROVED=true` + `AI_APPROVED_DOCUMENT_TYPES` birlikte sağlandığında açılır. Bu varsayım, kullanıcı/hukuk onayı gelene kadar geçicidir ve R-AI-01..03 kapsamında belirtilmelidir.
- JWT RS256 `node:crypto` ile uygulandı; şema doğrulaması elle yazıldı. `jose` ve `zod` kullanılmadı (mevcut bağımlılık kısıtı; kullanıcı tarafından açıkça istenmedi, mühendislik kararıdır).
- Gizli bilgi yalnızca ortam değişkenlerinden okunur; kodda varsayılan veya sahte kimlik bilgisi yoktur.

## Açık boşluklar

1. **E-imza tamamlandığında sözleşme sürümü oluşturma henüz yoktur.** Webhook yalnızca imzalı dosyanın kanıt kaydını (işlem kimliği, taraflar, zaman) yazar; imzalı dosyadan yeni sözleşme sürümü üretilmez. Bu, Faz 6 kapsamında istenen bir maddedir ve tamamlanmamıştır.
2. Gerçek dış sağlayıcılarla (Entra, SMTP/Graph, Teams, SharePoint, ERP, Gemini/Vertex) canlı bağlantı testi yapılmadı; kimlik bilgileri bu ortamda yoktur. Bu entegrasyonlar yalnızca arayüz ve test double ile doğrulanmıştır.
3. Tek süreçte tüm repo lint'i bellek nedeniyle çalışmıyor (yukarıda); paket bazında temizdir.
4. Kullanıcı tarafında yeniden koşum yapılmadı; `DOĞRULANDI` işaretlemesi yapılmamıştır.
