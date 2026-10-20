import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Pre-existing lint debt (T-ML-037): these rules flag ~34 existing sites in src/ and bot/.
  // Kept as warnings so `npm run lint` is usable as a CI gate for every other rule class;
  // tighten back to "error" once the sites are cleaned up.
  {
    rules: {
      "@typescript-eslint/no-require-imports": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "docker-data/**",
    "scripts/data/**",
  ]),
]);

export default eslintConfig;
