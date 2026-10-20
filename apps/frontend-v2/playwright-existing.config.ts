import { defineConfig } from "@playwright/test";

// Config for running against an already-running test server
// Usage: E2E_BACKEND_PORT=4202 npx playwright test --config=e2e/playwright-existing.config.ts
const backendPort = process.env.E2E_BACKEND_PORT || "4202";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  retries: 0,
  use: {
    baseURL: `http://localhost:${backendPort}`,
    extraHTTPHeaders: {},
  },
});
