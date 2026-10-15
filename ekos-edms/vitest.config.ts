import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Web rotaları "@/lib/..." içe aktarır; testlerde apps/web köküne eşlenir.
    alias: [{ find: /^@\/(.*)$/, replacement: `${fileURLToPath(new URL("./apps/web", import.meta.url))}/$1` }],
  },
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    exclude: ["**/node_modules/**", "e2e/**"],
    // Faz 0a: test seti henüz kısmi; boş set başarısızlık sayılmaz.
    // Bu ayar Faz 1'de kaldırılacak (ADR-0012 notu).
    passWithNoTests: true,
    environment: "node",
    restoreMocks: true,
  },
});
