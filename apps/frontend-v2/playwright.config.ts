import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  webServer: [
    {
      command: 'node ../frontend/e2e/reset-db.cjs && npx tsx src/server.ts',
      env: { COMBAT_NO_AUTH: '1', PORT: '3201' },
      port: 3201,
      reuseExistingServer: false,
      cwd: '../backend',
      timeout: 60000,
    },
    {
      command: 'npx vite --port 5174',
      env: { VITE_API_PORT: '3201' },
      port: 5174,
      reuseExistingServer: false,
      timeout: 60000,
    },
  ],
  use: { baseURL: 'http://localhost:5174' },
});
