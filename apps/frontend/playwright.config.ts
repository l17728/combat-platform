import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  webServer: [
    // DETERMINISM: run the backend WITHOUT `tsx watch`. The watcher's child
    // process is orphaned on Windows when Playwright stops the webServer and
    // keeps the SQLite WAL open, re-materializing the previous run's rows even
    // though global-setup deleted the db files. A single non-watch tsx process
    // is killed cleanly, so each run truly starts from the wiped db.
    // cwd = apps/backend so server.ts's process.cwd() resolves the db and
    // ../../config/schemas exactly as the npm workspace script would.
    { command: "node ../frontend/e2e/reset-db.cjs && npx tsx src/server.ts", port: 3001, reuseExistingServer: false, cwd: "../backend", timeout: 60000 },
    { command: "npm run dev --workspace=@combat/frontend", port: 5173, reuseExistingServer: false, cwd: "../..", timeout: 60000 },
  ],
  use: { baseURL: "http://localhost:5173" },
});
