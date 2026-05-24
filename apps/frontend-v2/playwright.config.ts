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
      port: 3001,
      reuseExistingServer: false,
      cwd: '../backend',
      timeout: 60000,
    },
  ],
  use: { baseURL: 'http://localhost:3001' },
});
