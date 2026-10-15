# Faz 7: çok aşamalı üretim imajı (web). Çalışma zamanı root DEĞİLDİR; yalnız standalone çıktı ve statik dosyalar taşınır.
# Derleme: docker build -f docker/web.Dockerfile -t ekos-web .   (Docker gerektirir; bu ortamda ÇALIŞTIRILMADI)

FROM node:20-alpine AS build
RUN apk add --no-cache libc6-compat openssl \
 && corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @ekos/db prisma:generate \
 && NEXT_TELEMETRY_DISABLED=1 pnpm --filter @ekos/web build

FROM node:20-alpine AS runtime
RUN apk add --no-cache libc6-compat openssl \
 && addgroup -S ekos && adduser -S -G ekos -h /app ekos \
 && mkdir -p /var/lib/ekos/storage && chown ekos:ekos /var/lib/ekos/storage
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY --from=build --chown=ekos:ekos /repo/apps/web/.next/standalone ./
COPY --from=build --chown=ekos:ekos /repo/apps/web/.next/static ./apps/web/.next/static
USER ekos
EXPOSE 3000
# Sağlık: oturumsuz /giris sayfası 200 döner (gerçek bağımlılık denetimi /api/health iskeletinde henüz yok).
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/giris > /dev/null || exit 1
CMD ["node", "apps/web/server.js"]
