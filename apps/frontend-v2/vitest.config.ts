import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// 前端单测配置:
//  - jsdom 模拟浏览器环境(localStorage / window / DOM)
//  - 仅扫描 src/__tests__/**/*.test.{ts,tsx} 与紧邻源码的 *.test.{ts,tsx};
//    不与 Playwright e2e (apps/frontend-v2/e2e/*.spec.ts) 冲突
//  - setupFiles 注入 @testing-library/jest-dom 的 expect 扩展
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/__tests__/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "src/__tests__/**/*.test.{ts,tsx}"],
    exclude: ["node_modules", "dist", "e2e/**"],
    css: false,
  },
} as any);
