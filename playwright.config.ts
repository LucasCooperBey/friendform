import { rmSync } from "node:fs";
import { defineConfig } from "@playwright/test";

// Workers load this file too; only the main process clears the data, before the server starts.
const dataDir = ".e2e-data/server";
if (process.env.TEST_WORKER_INDEX === undefined) rmSync(".e2e-data", { recursive: true, force: true });

const sessionSecret = "e2e-session-secret-not-secret-0123456789abcdefgh";

export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: [["list"], ["html", { open: "never" }]],
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  use: {
    baseURL: "http://127.0.0.1:4173",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "bun run build && node dist/server.mjs",
    url: "http://127.0.0.1:4173/api/health",
    reuseExistingServer: false,
    timeout: 180_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    env: {
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: "4173",
      DATA_DIR: dataDir,
      ADMIN_PASSWORD: "e2e-password-not-secret",
      SESSION_SECRET: sessionSecret,
      AI_BASE_URL: "http://127.0.0.1:4180/v1",
      AI_API_KEY: "e2e-not-a-key",
      AI_MODEL: "fake-model",
      DATABASE_URL: "",
      TRUST_PROXY: "",
      PUBLIC_URL: "",
      WEBHOOK_SECRET: "",
      TEST_DATABASE_URL: "",
    },
  },
});
