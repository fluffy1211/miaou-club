import { defineConfig, devices } from "@playwright/test";

// Refuse before starting servers or browsers: macOS Seatbelt blocks browser startup.
if (process.platform === "darwin" && process.env.CODEX_SANDBOX === "seatbelt") {
  throw new Error(
    "Playwright ne peut pas démarrer dans le sandbox macOS de Codex. " +
      "Relancer cette commande avec l'exécution Codex autorisée hors sandbox, " +
      "ou depuis le Terminal. Ne pas retirer CODEX_SANDBOX pour contourner cette garde.",
  );
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Authentication cookies must not be copied into report traces.
  use: {
    baseURL: "http://localhost:43991",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  reporter: "list",
  projects: [
    { name: "chromium-mobile", use: { ...devices["Pixel 7"] } },
    { name: "webkit-mobile", use: { ...devices["iPhone 13"] } },
  ],
  webServer: [
    {
      command: "tsx scripts/e2e-server.ts",
      url: "http://localhost:43991/api/health",
      reuseExistingServer: false,
      timeout: 60000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 10000 },
    },
    {
      command:
        "python3 -m http.server 43992 --bind 127.0.0.1 --directory storybook-static",
      url: "http://localhost:43992",
      reuseExistingServer: false,
    },
  ],
});
