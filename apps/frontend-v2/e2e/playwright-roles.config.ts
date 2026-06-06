import { defineConfig } from "@playwright/test";

const backendPort = process.env.E2E_BACKEND_PORT || "4203";

export default defineConfig({
  testDir: "./roles",
  fullyParallel: false,
  workers: 1,
  timeout: 120000,
  retries: 0,
  use: {
    baseURL: `http://127.0.0.1:${backendPort}`,
    extraHTTPHeaders: {},
  },
});
