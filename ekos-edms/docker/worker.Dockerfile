# Faz 7: çok aşamalı üretim imajı (OCR işçisi). Çalışma zamanı root DEĞİLDİR.
# OCR motoru (tesseract) ve Türkçe dil verisi gerekir: yalnız gerçek motor yapılandırılmışsa iş alır.
# Derleme: docker build -f docker/worker.Dockerfile -t ekos-worker .   (Docker gerektirir; bu ortamda ÇALIŞTIRILMADI)

FROM node:20-alpine AS build
RUN apk add --no-cache libc6-compat openssl \
 && corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo
COPY . .
# pnpm deploy, derlenmiş Prisma istemcisini taşımaz: üretilmiş .prisma dizini açıkça kopyalanır.
# Doğrulama: istemci hâlâ başlatılmamışsa derleme BAŞARISIZ olur.
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @ekos/db prisma:generate \
 && pnpm --filter @ekos/worker deploy --prod /out \
 && for d in node_modules/.pnpm/@prisma+client@*/node_modules/.prisma; do rm -rf "/out/$d" && mkdir -p "/out/$(dirname "$d")" && cp -r "$d" "/out/$d"; done \
 && ! grep -rq "did not initialize yet" /out/node_modules/.pnpm/@prisma+client@*/node_modules/.prisma/client/default.js

FROM node:20-alpine AS runtime
RUN apk add --no-cache libc6-compat openssl tesseract-ocr tesseract-ocr-data-tur \
 && addgroup -S ekos && adduser -S -G ekos -h /app ekos \
 && mkdir -p /var/lib/ekos/storage && chown ekos:ekos /var/lib/ekos/storage
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=ekos:ekos /out ./
USER ekos
CMD ["node_modules/.bin/tsx", "src/index.ts"]
