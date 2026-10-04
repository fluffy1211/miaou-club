import { defineConfig } from "eslint/config";
import js from "@eslint/js";
import ts from "typescript-eslint";
import astro from "eslint-plugin-astro";
export default defineConfig(
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      ".astro/**",
      "mockups/**",
      "docs/**",
      ".agents/**",
      ".codex/**",
      ".cache/**",
      "storybook-static/**",
      "test-results/**",
      "playwright-report/**",
      "server/drizzle/**",
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...astro.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["**/*.ts", "**/*.mjs", "**/*.astro"],
    languageOptions: {
      globals: {
        process: "readonly",
        performance: "readonly",
        console: "readonly",
        fetch: "readonly",
        URL: "readonly",
        Request: "readonly",
        Response: "readonly",
        Headers: "readonly",
        AbortSignal: "readonly",
        document: "readonly",
        window: "readonly",
        localStorage: "readonly",
        HTMLElement: "readonly",
        HTMLInputElement: "readonly",
        HTMLButtonElement: "readonly",
        HTMLSelectElement: "readonly",
        Element: "readonly",
        CustomEvent: "readonly",
        navigator: "readonly",
        location: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
      },
    },
  },
);
