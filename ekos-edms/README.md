# EKOS Enterprise Document & Contract Management (EKOS EDMS)

Tedarikçi ve danışman sözleşmelerinin yaşam döngüsünü ve bunun üzerine kurulu ortak belge yönetimini sağlayan kurum içi uygulama.

> **Durum: Faz 0a (iskelet).** Bu sürümde iş özelliği yoktur. Kimlik, yetki motoru mantığı, belge yükleme ve sözleşme akışı sonraki fazlarda gelecektir. Bkz. `docs/TRACEABILITY.md`.

## Önemli uyarılar

- **Uyumluluk iddiası yoktur.** KVKK, elektronik imza, ISO veya başka bir standarda uyum bu yazılım tarafından garanti edilmez. Bu konular **Hukuk/Veri Koruma incelemesi** gerektirir.
- **Hash zinciri yalnızca tahrifat tespiti sağlar.** Denetim kaydının değiştirilemezliğini garanti etmez; "değiştirilemezlik sertifikası" değildir.
- **Saklama süreleri, imza yetkileri, onay limitleri** kurum tarafından yapılandırılır; yazılım varsayılan hukuki değer atamaz.
- **Dijital kopya fiziksel aslın yerine geçmez.**

## Gereksinimler

- Node.js 20.11+ (`.nvmrc`: 20)
- pnpm 9.12.0 (`corepack enable && corepack prepare pnpm@9.12.0 --activate`)
- Docker ve Docker Compose v2 (yerel altyapı için)

## Yerel kurulum (Faz 0a)

```bash
# 1. Bağımlılıklar
pnpm install

# 2. Yerel gizli değerler (git'e girmez)
cp .env.example .env
#   .env dosyasını açın ve boş alanları doldurun. Parolaları güçlü ve rastgele seçin.

# 3. Altyapı
docker compose -f docker/docker-compose.yml up -d

# 4. Kalite kapıları
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

### Veritabanı (Faz 0b)

```bash
# Şema doğrulama (bağlantı açmaz; yer tutucu URL yeterli)
DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" pnpm db:validate

# Migration'ları gerçek PostgreSQL'e uygula (docker compose postgres ayakta olmalı)
pnpm db:migrate
```

Migration'lar: `0001_init` (Prisma üretimi) ve `0002_db_guards` (denetim izi salt-ekleme tetikleyicisi, imzalı sürüm koruması, CHECK kısıtları, arama indeksleri). Sıra değiştirilmez. Ayrıntı: ADR-0015, ADR-0016.

## Dizin yapısı

| Yol                 | İçerik                                                    |
| ------------------- | --------------------------------------------------------- |
| `apps/web`          | Next.js (UI + API)                                        |
| `apps/worker`       | Kuyruk işleyicileri (iskelet)                             |
| `packages/core`     | İş kuralları (tipler ve katalog; mantık sonraki fazlarda) |
| `packages/db`       | Prisma şeması (Faz 0b)                                    |
| `packages/adapters` | Dış sistem sınırları                                      |
| `docker/`           | Compose ve Dockerfile'lar                                 |
| `docs/`             | Mimari, ADR, izin matrisi, izlenebilirlik                 |
| `e2e/`              | Playwright senaryoları (Faz 5+)                           |

## Güvenlik notları (geliştirici)

- `.env`, `.env.*` (`.env.example` hariç) ve veri dizinleri `.gitignore` içindedir.
- `docker-compose.yml` portları yalnızca `127.0.0.1`'e bağlar.
- Hiçbir parola kodda gömülü değildir; eksik değişken compose tarafından reddedilir.

## Belgeler

- `docs/ARCHITECTURE.md` — mimari sözleşme ve akışlar
- `docs/DECISIONS.md` — ADR'ler
- `docs/PERMISSIONS.md` — izin matrisi ve rol şablonları (taslak; onay gerekir)
- `docs/TRACEABILITY.md` — gereksinim izlenebilirliği
