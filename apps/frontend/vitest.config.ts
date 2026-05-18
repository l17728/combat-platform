import { defineConfig } from "vitest/config";

// Keep Playwright e2e specs (e2e/**) out of the vitest unit run; they import
// @playwright/test which is not runnable under vitest.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
  },
});
