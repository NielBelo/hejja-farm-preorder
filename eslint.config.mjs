import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generált kimenetek: az OpenNext build és a helyreállítási bundle-ök.
    ".open-next/**",
    "scripts/.recovery/**",
  ]),
  {
    // A CommonJS tesztek és a Node-szkriptek require()-t használnak.
    files: ["**/*.cjs", "scripts/**"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
]);

export default eslintConfig;
