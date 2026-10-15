# Faz 3 Raporu — Sözleşme yaşam döngüsü, onay akışı, yenileme tarihi

Tarih: 2026-10-14. Durum: **Faz 3 çekirdeği tamamlandı ve uçtan uca doğrulandı. Arayüz (sözleşme ekranları) EKSİK; bkz. §4.**

Etiketler: **DOĞRULANDI** = bu ortamda çalıştırıldı ve sonuç gözlendi. **KISMEN** = bir kısmı doğrulandı. **DOĞRULANMADI** = çalıştırılmadı.

Not: Faz 3'ün tam metni çalışma alanında yoktur. Kapsam, `docs/TRACEABILITY.md` içindeki Faz 3 gereksinimlerinden (R-LC-03..06, R-WF-01..03, R-RNW-01, R-DB-05) ve `docs/ARCHITECTURE.md`'deki sözleşme/iş akışı şemasından türetildi. Eksik kalan kapsam varsa aşağıdaki §4'te açıkça listelidir.

## 1. Doğrulama özeti

| Kontrol | Sonuç |
|---|---|
| Tüm testler `vitest run` (28 dosya) | DOĞRULANDI — 313/313 geçti, EXIT=0 (log: `/tmp/vitest-all.log`, 07:37). Aynı koşuda `orphans.test.ts` ve Faz 3 testleri dahil. |
| `tsc --noEmit` core, db, db/scripts | DOĞRULANDI — EXIT=0 (`/tmp/tc-all.log`, 07:36). |
| `tsc --noEmit` apps/web | DOĞRULANDI — EXIT=0 (`/tmp/tc-web.log`, 07:37). İlk denemede bellek nedeniyle EXIT=137 (öldürüldü); bu, kodla ilgili bir hata değildir. |
| `next build` (apps/web) | DOĞRULANDI — EXIT=0 (`/tmp/next-build3.log`). Önceki deneme bellek nedeniyle öldürüldü. |
| ESLint (tüm depo) | DOĞRULANMADI — `/tmp/eslint3.log` boş, çıkış kodu kaydedilmedi. Yeniden çalıştırılmadı. |
| Prisma migration 0009 | DOĞRULANMADI bu raporda ayrıca kontrol edilmedi (log: `/tmp/migrate.log`). |
| HTTP uçtan uca (gerçek sunucu, gerçek DB) | DOĞRULANDI — §3.3 |
| Tarayıcı görsel kontrolü (giriş sayfası) | DOĞRULANDI — `docs/ekran-giris.png` (Chromium, 1280x800, başlık "EKOS EDMS"). Sayfa, SSO'nun yapılandırılmadığını ve yerel girişin kullanıldığını gösteriyor. |

Not: Test dosyası `lifecycle.test.ts` içinde kullanılmayan `CID` değişkeni (TS6133) önceki `tsc` çalıştırmasında (07:18) hata vermişti; sonraki `db` tsc koşusu (07:36) EXIT=0 döndü.

## 2. Uygulanan gereksinimler

| Gereksinim | Uygulama | Kanıt |
|---|---|---|
| **R-LC-02** Geçiş tablosu dışı geçiş reddedilir | `packages/core/src/contracts/lifecycle.ts` (`CONTRACT_TRANSITIONS`, `checkContractTransition`) | core testleri; HTTP: geçersiz adımlar 422 |
| **R-LC-03** Tüm onaylar olmadan `READY_FOR_SIGNATURE` yok | Onay örneği `COMPLETED` olmadan geçiş reddedilir; `COMPLETED` olunca otomatik geçiş | DB testi (adım-2 öncesi durum PENDING_APPROVAL); HTTP: adım-2 onayı → `READY_FOR_SIGNATURE` |
| **R-LC-04** İmza kanıtı olmadan `ACTIVE` yok | `recordSignatureAndActivate`: kanıt kaydı ve `ACTIVE` aynı transaction'da; kanıt yoksa geçiş yok | DB testi; HTTP: sürüm/kanıt yokken imza → 404 "Geçerli sürüm yok" |
| **R-LC-05** `ACTIVE` imzalı sürüm değişmez | İmzalanınca sürüm `isSigned` + `isReadOnly`; aktif/imzalı sözleşmede `createNewVersion` `VERSION_LOCKED` (409) | DB testi: ACTIVE sonrası yeni sürüm reddedildi |
| **R-LC-06** `IMPORTED_HISTORICAL` onay gibi gösterilmez | Geçmiş kayıt `ARCHIVED` olarak başlar; `READY/SIGNATURE/ACTIVE` geçişi `HISTORICAL_NOT_APPROVABLE`; onay görevi oluşmaz; API'den geçmiş kayıt oluşturulamaz (`origin` sabit `MANUAL`) | DB testi (görev sayısı 0) |
| **R-WF-01** Başlamış örnek tanım sürümüne sabitlenir | Başlatmada yayımlı sürüm `definitionVersionId` olarak yazılır; sonradan yayımlanan yeni sürüm eski örneği etkilemez | DB testi; HTTP: `definitionVersionId` döner |
| **R-WF-02** Onay matrisi yoksa akış başlatılamaz | Tanım/yayımlı sürüm yok veya yalnız taslak → `WORKFLOW_NOT_STARTABLE` (422); durum DRAFT kalır | DB testi (2 senaryo); matris CLI'si doğrulamalı |
| **R-WF-03** Başlatan kendi onayını veremez | `checkApprovalDecision`: başlatan = atanan → `SELF_APPROVAL_BLOCKED` (403). Politika bayrağı varsayılan kapalı; API'de açılamaz | core + DB testi |
| **R-RNW-01** Yenileme tarihi yalnız doğrulanmış kuralla | `computeNoticeDeadline`: `verifiedAt` ve `approvedAt` yoksa veya tarih/kural geçersizse `NEEDS_MANUAL_VERIFICATION`. Ay çıkarımında ay sonu sabitlenir. İş günü/tatil takvimi kodlanmadı (belirsizlik elle doğrulanır) | core 8 test; DB testi (önce NEEDS, sonra 2027-03-01) |
| **R-DB-05** Red gerekçesi zorunlu | Servis katmanı (`REASON_REQUIRED` 422) + mevcut DB CHECK; RED ve RETURN için | core/DB/HTTP: gerekçesiz red 422 |

### Ek kararlar (uzman kararı; kullanıcıya sorulmadı)

- **Red sonucu:** RED → örnek `REJECTED`, sözleşme `CANCELLED`. GERİ GÖNDERME → örnek `RETURNED`, sözleşme `IN_REVIEW`. Her ikisinde gerekçe zorunlu ve denetim kaydına yazılır.
- **Sıralı adımlar:** önceki adım tamamlanmadan sonraki adımın görevi karara bağlanamaz (403).
- **Adım tamamlanması:** `requiredApprovals` kadar `APPROVED`; kalan bekleyen görevler `CANCELLED`.
- **Geçmiş içe aktarılmış sözleşme** yalnızca arşiv/sona erme durumlarına geçebilir; imza kanıtı olsa bile onay akışına alınmaz (R-LC-06).
- **Onay matrisi** veritabanında sabit kodlanmadı. `packages/db/scripts/publish-approval-matrix.ts` ile yönetici e-postalarından yayımlanır. Matris yayımlanmadan kimse sözleşme onayı başlatamaz (R-WF-02 gereği bilerek).
- **Bu sürümde yayımlı matris YOK** (geliştirme veritabanında yalnız E2E için bir test matrisi yayımlandı, sürüm 1, test kullanıcılarıyla). Üretimde gerçek onaycılarla matris yayımlanmalıdır.

## 3. Uygulama ayrıntıları

### 3.1 Veri modeli (migration 0009)
- `ContractSignatureEvidence`: `contractId`, `documentVersionId` (benzersiz), `signedAt`, `signatureMethod`, `signerSummary`, `recordedById`. Boş yöntem/imzacı CHECK ile reddedilir.
- Mevcut `ContractRecord`, `WorkflowDefinition(Version)`, `WorkflowInstance`, `WorkflowStep`, `ApprovalTask`, `ApprovalDecision`, `RenewalRule` modelleri kullanıldı; yeni alan eklenmedi.

### 3.2 Servisler
- `packages/db/src/contracts/lifecycle.ts`: `createContract`, `startContractApproval`, `decideApprovalTask`, `recordSignatureAndActivate`, `getNoticeDeadline`.
- Her durum değişikliği `CONTRACT_STATUS_CHANGED` veya ilgili denetim olayıyla kaydedilir.
- `DomainError` kodları eklendi: `TRANSITION_DENIED`, `WORKFLOW_NOT_STARTABLE`, `DECISION_DENIED`, `VERSION_LOCKED`, `IDEMPOTENCY_CONFLICT`.

### 3.3 HTTP uçtan uca (gerçek sunucu 0.0.0.0:3000, gerçek DB)
| Adım | Sonuç |
|---|---|
| Sözleşme oluştur (`SUPPLIER_CONTRACT`, belge tarihi, karşı taraf) | 201, `EKOS-SC-2026-000001`, DRAFT |
| Onay başlat (matris sürüm 1) | 201, sürüme sabitlendi |
| İmza, onaylar bitmeden | 422 "Sözleşme imza aşamasında değil" |
| Adım-2 onayı, adım-1 bitmeden | 403 "Önceki onay adımı tamamlanmadı" |
| Atanmamış göreve onay | 403 "Bu onay görevi size atanmamış" |
| Gerekçesiz RED | 422 "Red ve geri gönderme için gerekçe zorunludur" |
| Adım-1 onayı | 200, `PENDING_APPROVAL` |
| Aynı görevi tekrar onaylama | 409 |
| Adım-2 onayı | 200, `COMPLETED` → `READY_FOR_SIGNATURE` |
| İmza (sürümsüz) | 404 "Geçerli sürüm yok"; sözleşme ACTIVE olmaz |
| İkinci sözleşme: gerekçeli RED | 200, `REJECTED` → `CANCELLED` |

Uçtan uca sonuçta sürüm kaydı olmayan sözleşme imzalanamadığı için **gerçek imzalı ACTIVE akışı HTTP ile DOĞRULANMADI**; bu yol DB testinde (`recordSignatureAndActivate`, sürüm + kanıt + ACTIVE + kilit) doğrulandı. HTTP ile tam yol için belge dosyası yüklenmiş (CLEAN) bir sözleşme gerekir.

### 3.4 Yönetici CLI'leri
- `packages/db/scripts/publish-approval-matrix.ts`: `EKOS_MATRIX_FILE` JSON'u; aktif kullanıcı ve matris kurallarını doğrular; sürüm yayımlar; denetim kaydı.

## 4. Eksik / sınırlar (dürüst liste)

- **Sözleşme arayüzü (EKRAN) YOK.** Oluşturma, onay kuyruğu, karar ve imza işlemleri yalnızca API ile yapılabilir. Kullanıcıya görünür ekran Faz 3'ün açık işi olarak kalıyor.
- **Yetki modeli:** Sözleşme rotalarının kaynak bazlı (kapsamlı) yetki kontrolü DOĞRULANMADI.
- **Yenileme tarihi API'de yok:** `getNoticeDeadline` servis olarak var ve testli; HTTP uç noktası eklenmedi.
- **İş günü ve tatil takvimi:** kodlanmadı. Doğrulanmış kurallarda tarih takvim günü/ay olarak hesaplanır; hafta sonu kaydırması yapılmaz. Bu, sözleşme hükmü gerektiriyorsa hukuk onayı ile eklenmeli.
- **Quorum:** yalnızca `requiredApprovals` sayısı uygulanır; `ANY/ALL` ayrımı şemada var ama servis onu ayrıca yorumlamaz (adım sayısı yeterli sayıya ulaşınca tamamlanır).
- **Yayımlı matris yönetimi:** CLI var; yönetici arayüzü yok. Matris düzenleme/geri alma ekranı Faz 5 kapsamında değerlendirilmeli.
- **Geliştirme tüzel kişisi:** `LegalEntity` tablosunda gerçek kurum kaydı yoktu. Geliştirme için "EKOS GELİŞTİRME TEST TÜZEL KİŞİSİ" adıyla etiketli bir kayıt eklendi. **Üretimde gerçek kurum bilgisiyle değiştirilmeli.**

## 5. Geliştirme ortamı notları

- Sandbox belleği yaklaşık 2 GB. clamd (~1 GB RSS) ile Next/TypeScript derlemeleri aynı anda çalışınca bellek tükendi; `tsc` ve `next build` bu nedenle clamd kapalıyken çalıştırıldı, sonra clamd gerçek imzalarla yeniden açıldı (`oom_score_adj -900`, PONG).
- Tam depo ESLint çalıştırması **DOĞRULANMADI** (çıkış kodu kaydedilmedi).

## 6. Test verisi (geliştirme veritabanı)

- Faz 3 E2E kullanıcıları (`faz3-init`, `faz3-apb`, `faz3-apc` @ekos.local) **devre dışı bırakıldı** (denetim kaydı `USER_DISABLED`).
- Sözleşmeler `EKOS-SC-2026-000001` (onaylandı, READY, imzasız) ve ikinci sözleşme (reddedildi, CANCELLED) test kayıtları olarak kaldı. Belge kayıtları veritabanı tetikleyicisiyle silinemez; bu bilinçli bir koruma.
- Test karşı tarafları ve test belgeleri Faz 2 raporu §5'te listelidir.
