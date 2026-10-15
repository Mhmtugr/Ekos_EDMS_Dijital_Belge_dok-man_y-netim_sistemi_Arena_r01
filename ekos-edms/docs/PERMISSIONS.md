# İzin Matrisi ve Rol Şablonları

> Durum: **taslak — hukuk, İK ve güvenlik onayı gerekir.** Bu matris sistem kataloğudur (A5/1): gerçek kullanıcı veya kayıt içermez. Kurum, roller ve kapsamları Faz 5 kurulum sihirbazında değiştirebilir; ama her değişiklik ikinci onaycı gerektirir.

## 1. Kurallar

- **Varsayılan: reddet.** Açık izin olmadan hiçbir işlem yapılmaz.
- **DENY her zaman önceliklidir** (belge ACL'sinde açık `DENY`).
- **Kapsam** (Membership): `departmentIds`, `documentTypeIds`, `counterpartyIds`, `projectIds`, `maxConfidentiality`, `documentId`. Boş alan = kısıt yok; dolu alan = kesişim zorunlu.
- **Platform Yöneticisi** ve **Güvenlik Denetçisi**: **belge içeriği izni yoktur** (bkz. §4).
- **404/403**: görmeye hiç yetkisi olmayan kaynak 404; görüp eylemi olmayan 403.

## 2. Lejant

| Sembol | Anlam                                                                                         |
| ------ | --------------------------------------------------------------------------------------------- |
| ✔      | İzin var, kapsam kısıtı yok (sistem genelinde, ancak gizlilik seviyesi ve ACL yine uygulanır) |
| K      | İzin var, **kapsamla kısıtlı** (departman/tür/karşı taraf/proje/gizlilik)                     |
| Y      | İzin var, **yapılandırmaya bağlı** (ikinci onaycı veya kurum politikası gerekir)              |
| —      | İzin yok                                                                                      |

## 3. Rol şablonları (kısaltma)

| Kısaltma | Rol                                                                     | Kapsam tipik değeri                                |
| -------- | ----------------------------------------------------------------------- | -------------------------------------------------- |
| PY       | Platform Yöneticisi                                                     | Kapsam yok; içerik yok                             |
| KA       | Kayıt/Arşiv Yöneticisi                                                  | Tüm kayıtlar, içerik yönetimi                      |
| DS       | Departman Belge Sorumlusu                                               | Kendi departmanı                                   |
| SY       | Sözleşme Yöneticisi                                                     | İlgili karşı taraf/tür                             |
| HI       | Hukuk İnceleyicisi                                                      | Sözleşme kartları, hukuki bekletme                 |
| DK       | Departman Kullanıcısı (satın alma/finans/kalite/üretim/ithalat-ihracat) | Kendi departmanı; **İK ayrı ve varsayılan kapalı** |
| ON       | Onaycı                                                                  | Atandığı onay görevleri                            |
| ID       | İç Denetçi                                                              | Denetim kapsamı; içerik yalnız kapsamlı            |
| SR       | Salt Okunur Kullanıcı                                                   | Kapsamlı görüntüleme                               |
| GD       | Güvenlik Denetçisi                                                      | Audit; **belge içeriği yok**                       |

## 4. Özel kurallar (açıkça)

- **Platform Yöneticisi (PY):** `user.manage`, `role.manage`, `config.manage`, `integration.manage` (ADR-0011), `system.health`. **Hiçbir `document.*` veya `contract.*` izni yoktur.** Belge içeriğine erişemez, kendini belge ACL'sine ekleyemez, bir belge için break-glass talep edemez.
- **Güvenlik Denetçisi (GD):** `audit.view`, `audit.export`, `system.health`, `breakglass.approve` (ADR-0009 gerekçesi; onay GD'ye içerik erişimi vermez, erişimi break-glass GRANT'i verir). **Hiçbir belge içeriği, önizleme, indirme veya OCR metni izni yoktur.**
- **İK belge türleri** varsayılan `HIGHLY_RESTRICTED`; DK rolü için varsayılan kapalıdır.
- **Ayrılık ilkesi:** imha onayı (`document.disposal_approve`) başlatan kişiye verilmez; ikinci onaycı farklı kişi olmalıdır (Faz 4).
- **Kendi onayını verememe:** onay akışını başlatan kişi o akıştaki onayı veremez (yapılandırılabilir ama varsayılan açık).

## 5. İzin × rol matrisi

| İzin kodu                   | PY  | KA  | DS  | SY  | HI  | DK  | ON  | ID  | SR  | GD  |
| --------------------------- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| document.list               | —   | ✔   | K   | K   | K   | K   | K   | K   | K   | —   |
| document.view_metadata      | —   | ✔   | K   | K   | K   | K   | K   | K   | K   | —   |
| document.preview            | —   | ✔   | K   | K   | K   | K   | K   | —   | K   | —   |
| document.download           | —   | ✔   | K   | K   | K   | K   | —   | —   | —   | —   |
| document.upload             | —   | ✔   | K   | K   | —   | K   | —   | —   | —   | —   |
| document.edit_metadata      | —   | ✔   | K   | K   | —   | K   | —   | —   | —   | —   |
| document.new_version        | —   | ✔   | K   | K   | —   | K   | —   | —   | —   | —   |
| document.start_workflow     | —   | —   | K   | K   | —   | K   | —   | —   | —   | —   |
| document.approve            | —   | —   | —   | —   | —   | —   | K   | —   | —   | —   |
| document.archive            | —   | ✔   | K   | K   | —   | —   | —   | —   | —   | —   |
| document.retention_review   | —   | ✔   | —   | —   | —   | —   | —   | —   | —   | —   |
| document.disposal_approve   | —   | Y   | —   | —   | —   | —   | —   | —   | —   | —   |
| document.manage_permissions | —   | ✔   | K   | —   | —   | —   | —   | —   | —   | —   |
| document.export             | —   | ✔   | —   | —   | —   | —   | —   | K   | —   | —   |
| document.legal_hold         | —   | —   | —   | —   | ✔   | —   | —   | —   | —   | —   |
| contract.create             | —   | —   | K   | ✔   | —   | —   | —   | —   | —   | —   |
| contract.manage_obligations | —   | —   | K   | ✔   | —   | —   | —   | —   | —   | —   |
| contract.legal_review       | —   | —   | —   | —   | ✔   | —   | —   | —   | —   | —   |
| contract.record_signature   | —   | —   | —   | ✔   | —   | —   | —   | —   | —   | —   |
| counterparty.manage         | —   | —   | —   | ✔   | —   | —   | —   | —   | —   | —   |
| user.manage                 | ✔   | —   | —   | —   | —   | —   | —   | —   | —   | —   |
| role.manage                 | ✔   | —   | —   | —   | —   | —   | —   | —   | —   | —   |
| config.manage               | ✔   | —   | —   | —   | —   | —   | —   | —   | —   | —   |
| integration.manage          | ✔   | —   | —   | —   | —   | —   | —   | —   | —   | —   |
| audit.view                  | —   | —   | —   | —   | —   | —   | —   | K   | —   | ✔   |
| audit.export                | —   | —   | —   | —   | —   | —   | —   | K   | —   | ✔   |
| system.health               | ✔   | —   | —   | —   | —   | —   | —   | —   | —   | ✔   |
| breakglass.request          | —   | ✔   | —   | —   | ✔   | —   | —   | —   | —   | —   |
| breakglass.approve          | —   | —   | —   | —   | —   | —   | —   | —   | —   | ✔   |

### 5.1 Notlar

- `document.approve` ON'da kapsamlıdır: yalnızca kendisine atanmış onay görevlerinde geçerlidir.
- `document.export` ID'de yalnızca **kanıt paketi** (denetim kapsamı, belge içeriği değil) anlamındadır; tam belge dışa aktarımı KA'dadır ve audit'e yazılır.
- `breakglass.request` yalnızca içerik erişimi olan KA ve HI'ye verilir; GD talep edemez (denetleyen, erişen olmamalı).
- Kapsam kısıtı olmayan ✔ izinler bile gizlilik seviyesi ve belge ACL'sinden geçer.

## 6. Dikkat: hukuki ve İK onayı gereken noktalar

- İK belge türlerinin varsayılan erişimi (DK kapalı) → **İK + Hukuk/Veri Koruma incelemesi gerekir.**
- İmha onaycıları ve ayrılık ilkesi → **Hukuk onayı gerekir.**
- `integration.manage` yalnızca PY'de (ADR-0011) → **Güvenlik onayı gerekir.**
- Break-glass süre sınırı ve ikinci onaycı kuralı → **Güvenlik ve Hukuk onayı gerekir.**
