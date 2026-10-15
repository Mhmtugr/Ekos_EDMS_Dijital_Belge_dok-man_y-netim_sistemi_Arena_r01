// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/next-env.d.ts",
      // Prisma yapılandırma dosyası hiçbir tsconfig projesinde değildir (Faz 0a); tip-bilgili lint kapsamı dışında.
      "packages/db/prisma.config.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked.map((c) => ({
    ...c,
    files: ["**/*.ts", "**/*.tsx", "**/*.mts"],
  })),
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mts"],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  {
    files: ["**/*.mjs", "**/*.js", "**/*.cjs"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { globals: { ...globals.node } },
  },
  prettier,
);
