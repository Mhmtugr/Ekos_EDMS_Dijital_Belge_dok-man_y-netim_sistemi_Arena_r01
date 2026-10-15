/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // @ekos/core kaynak TypeScript olarak paketlenir (derleme adımı yok).
  transpilePackages: ["@ekos/core", "@ekos/db", "@ekos/adapters"],
  // Prisma ve native argon2 paketleri paketlenmez; çalışma zamanında Node modülü olarak yüklenir.
  serverExternalPackages: ["@prisma/client", "@node-rs/argon2"],
  webpack: (config) => {
    // ESM kuralı: kaynakta "./x.js" yazılır, dosya ".ts"tir.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
  // Standalone izleme Prisma sorgu motorunu (libquery_engine) kendiliğinden almaz; açıkça dahil edilir.
  // Dahil edilmezse imajda veritabanı çağrıları başarısız olur (doğrulandı: /api/health 503).
  outputFileTracingIncludes: {
    "*": ["../../node_modules/.pnpm/@prisma+client@*/node_modules/.prisma/client/**"],
  },
  // Güvenlik başlıkları ve CSP Faz 1'de (middleware) eklenecek.
  output: "standalone",
};

export default nextConfig;
