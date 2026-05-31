import { test, expect } from "@playwright/test";

// 数据库迁移页:
// - 仅 admin 可访问(AdminGuard 守卫;非 admin 跳回首页)
// - 默认 e2e 用户是 admin → 应能加载页面
// - status API 会返回 sqlite 状态(当前 backend 默认就是 sqlite)
test.describe("数据库迁移 UI (系统管理 → 数据库迁移)", () => {
  test("admin 可访问页面 + 看到当前驱动 SQLITE", async ({ page }) => {
    await page.goto("/db-migration");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: /数据库迁移/ })).toBeVisible();
    // 状态卡里应包含 SQLITE 标签(driver tag)
    await expect(page.locator(".ant-tag").filter({ hasText: "SQLITE" })).toBeVisible({ timeout: 10000 });
    // 三段标题
    await expect(page.getByText("① 当前数据库状态")).toBeVisible();
    await expect(page.getByText("② 目标连接 + 执行")).toBeVisible();
  });

  test("测试连接按钮对错误 URL 给反馈", async ({ page }) => {
    await page.goto("/db-migration");
    await page.waitForLoadState("networkidle");
    await page.getByPlaceholder(/postgresql:\/\/user/).fill("not-a-valid-url");
    await page.getByRole("button", { name: /测\s?试连接/ }).click();
    // 应弹出表单校验错误(必须以 postgres:// 开头)
    await expect(page.locator(".ant-form-item-explain-error").filter({ hasText: /必须以 postgres/ })).toBeVisible();
  });
});
