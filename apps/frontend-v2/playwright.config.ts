import { defineConfig } from "@playwright/test";

// 默认 3201/5174;在 worktree 并发跑测试时,通过 E2E_BACKEND_PORT/E2E_FRONTEND_PORT 改端口避撞
const backendPort = process.env.E2E_BACKEND_PORT || "3201";
const frontendPort = process.env.E2E_FRONTEND_PORT || "5174";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  webServer: [
    {
      command: "node ../frontend/e2e/reset-db.cjs && npx tsx src/server.ts",
      env: { COMBAT_NO_AUTH: "1", PORT: backendPort, NODE_ENV: "test" },
      port: Number(backendPort),
      reuseExistingServer: false,
      cwd: "../backend",
      timeout: 60000,
    },
    {
      command: `npx vite --port ${frontendPort}`,
      env: { VITE_API_PORT: backendPort },
      port: Number(frontendPort),
      reuseExistingServer: false,
      timeout: 60000,
    },
  ],
  use: { baseURL: `http://localhost:${frontendPort}` },
});
