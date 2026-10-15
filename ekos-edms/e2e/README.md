# E2E (Playwright)

## Mevcut senaryolar (`e2e/faz5.spec.ts`) — 19/19 geçiyor

- **Giriş:** yanlış parola hata gösterir ve oturum açmaz; doğru giriş Genel Bakış'a götürür ve çıkış yapılır; oturumsuz yönetim sayfası giriş ekranına yönlenir.
- **Yetki sınırları:** denetçi `/yonetim/denetim` sayfasını göremez ve rapor türü listesinde "Denetim kayıtları" yoktur; kullanıcı onay raporunu göremez ve sunucu `POST /api/reports/export` isteğini reddeder.
- **Dışa aktarma:** onaycı "Açık onay görevleri" raporunu XLSX olarak indirir.
- **Yönetim ekranları yetki sınırı:** kullanıcı kurulum/hatırlatma ayarlarını göremez ve `/api/settings` 403 alır; yönetici hatırlatma aralığını doğrular ve kaydeder.
- **Erişilebilirlik (axe, WCAG 2.2 AA):** `/giris`, `/yonetim`, `/yonetim/sozlesmeler`, `/yonetim/gorevler`, `/yonetim/raporlar`, `/yonetim/bildirimler`, `/yonetim/hatirlatma`, `/yonetim/kurulum`, `/yonetim/belgeler`, `/yonetim/yuklemeler`, `/yonetim/ice-aktarim`.

### Oturum ve hız sınırı

`e2e/global-setup.ts` her test kullanıcısının oturumunu bir kez açar (çerez ortam değişkeninde taşınır, diske yazılmaz). Giriş uç noktası IP başına 15 dakikada 30 denemeyle sınırlıdır; testler her seferinde giriş yapsaydı bu sınıra takılırdı. Yalnızca giriş ekranını sınayan testler gerçek form girişi kullanır.

## Henüz yazılmadı (açık)

Aşağıdaki senaryolar Faz 5 kapsamında istenmiştir ve henüz E2E olarak yazılmamıştır:

- Arama, belge yükleme (gerçek akışla), sözleşme onayı ve hatırlatma olayının uçtan uca üretilmesi (şu an yalnız birim/entegrasyon testleriyle kapsanıyor).
- Belge yükleme ve içe aktarım akışlarının derin işlevsel testleri (şu an yalnız ekran erişimi ve axe).

## Ön koşullar

1. Geliştirme PostgreSQL'i (`packages/db/scripts/pg-dev.mjs`, port 54330), migrasyon (`prisma migrate deploy`), katalog (`scripts/seed.ts`) ve test kullanıcıları (`scripts/dev-users.ts`).
2. Parola `EKOS_DEV_PASSWORD` ortam değişkeninde olmalı (ör. `set -a; . ~/.ekos-dev.env; set +a`).
3. Uygulama çalışıyor olmalı. Zamanlı işler için: `apps/web` içinde `JOBS_ACTOR_EMAIL=yonetici@ekos.test npm run jobs` (ya da `-- --once`). Testler üretim derlemesiyle koşulmalıdır: `apps/web` içinde `next build --no-lint`, ardından `node .next/standalone/server.js` veya `next start`. Geliştirme sunucusu her sayfayı ilk istekte derlediği için testler yavaş ve zaman aşımına açık olur.
4. Tarayıcı sistem kütüphaneleri: `sudo npx playwright install-deps chromium` (bir kez).

## Çalıştırma

```bash
set -a; . ~/.ekos-dev.env; set +a
E2E_BASE_URL=http://localhost:3000 npx playwright test e2e/faz5.spec.ts
```

## Sözleşme akışı (`sozlesme-akisi.spec.ts`)

- Kullanıcı: `sozlesme@ekos.test` (CONTRACT_MANAGER) — global setup beş oturumu açar.
- Ön koşul: `dev-users.ts` çalıştırılmış olmalı (yayımlı `CONTRACT_APPROVAL` matrisi dahil).
- `fixtures/sozlesme-ornek.pdf`: test için minimal geçerli PDF.
- Tarama sonucu: CLAMD_HOST tanımlı ama servis kapalıysa sonuç `UNAVAILABLE` olur ve imza reddedilir. Gerçek imza → ACTIVE yolu, çalışan bir ClamAV gerektirir.
- Giriş hız sınırı (IP başına 30 / 15 dk): E2E sırasında web sürecini yeniden başlatmak sayacı sıfırlar.
