// Prisma yapılandırması (package.json#prisma kullanımdan kaldırıldı). Şema klasörü ve migration yolu açıkça belirtilir.
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema",
  migrations: {
    path: "prisma/migrations",
  },
});
