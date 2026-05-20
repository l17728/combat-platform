import { test, expect } from "@playwright/test";

// FE-CN1 防回归门禁：任何关键页加载完不应有 console error / warning。
// 这是一类问题（AntD/React Router 弃用 API、favicon 404、未处理的 promise reject 等）
// 的统一防御 —— 任何让首次访问看到红色 console 信息的代码都会失败这条测试。
const PAGES = ["/", "/attack", "/conflicts", "/honor", "/search", "/proposals", "/reminders", "/daily-report", "/releases", "/weights", "/import", "/contributions"];

for (const path of PAGES) {
  test(`FE-CN1 ${path} loads with zero console errors/warnings`, async ({ page }) => {
    const issues: { type: string; text: string }[] = [];
    page.on("console", msg => {
      const t = msg.type();
      if (t === "error" || t === "warning") issues.push({ type: t, text: msg.text() });
    });
    page.on("pageerror", err => issues.push({ type: "pageerror", text: err.message }));
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    // Allow a tick for late warnings (React StrictMode double-invoke).
    await page.waitForTimeout(200);
    expect(issues, `${path} should have no console issues, got:\n${issues.map(i => `  [${i.type}] ${i.text}`).join("\n")}`).toEqual([]);
  });
}
