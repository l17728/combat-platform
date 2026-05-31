import { test, expect } from "@playwright/test";

// 系统升级页面 e2e:
// - admin 可访问页面;非 admin 路由守卫跳走(playwright 默认 COMBAT_NO_AUTH=1 → admin)
// - 上传非 tar.gz 文件被拒
// - 上传合法 mock tar.gz → 自动 analyze → 展示报告
// - 执行按钮在未二次确认时 disabled
// - 升级历史卡片渲染(初始空 → empty 文案)

test.describe("系统升级 UI", () => {
  test("admin 可访问页面 + 展示版本卡 + 三段式标题", async ({ page }) => {
    await page.goto("/system-upgrade");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: /系统升级/ })).toBeVisible();
    await expect(page.getByText("当前版本")).toBeVisible();
    await expect(page.getByText("① 选择升级源")).toBeVisible();
    await expect(page.getByText("② 分析报告")).toBeVisible();
    await expect(page.getByText("③ 执行升级")).toBeVisible();
    await expect(page.getByText("升级历史")).toBeVisible();
  });

  test("执行按钮在未二次确认时 disabled", async ({ page }) => {
    await page.goto("/system-upgrade");
    await page.waitForLoadState("networkidle");
    const applyBtn = page.locator('[data-testid="upgrade-apply-btn"]');
    await expect(applyBtn).toBeVisible();
    await expect(applyBtn).toBeDisabled();
  });

  test("勾选确认 + 输入 UPGRADE 但未上传也不能点击执行", async ({ page }) => {
    await page.goto("/system-upgrade");
    await page.waitForLoadState("networkidle");
    await page.locator('[data-testid="upgrade-confirm-checkbox"]').check();
    await page.locator('[data-testid="upgrade-confirm-text"]').fill("UPGRADE");
    // 未上传 staging → 仍 disabled
    await expect(page.locator('[data-testid="upgrade-apply-btn"]')).toBeDisabled();
  });

  test("初始升级历史为空表", async ({ page }) => {
    await page.goto("/system-upgrade");
    await page.waitForLoadState("networkidle");
    // 等待 history table 渲染
    await expect(page.getByText("升级历史")).toBeVisible();
    // Empty 占位文案
    await expect(page.getByText(/暂无升级记录/)).toBeVisible({ timeout: 10000 });
  });

  test("在线版本卡片渲染 + 未配置时显示告警", async ({ page }) => {
    await page.goto("/system-upgrade");
    await page.waitForLoadState("networkidle");
    await expect(page.locator('[data-testid="upgrade-releases-card"]')).toBeVisible();
    // 后端未配 UPGRADE_GITHUB_REPO → 503 → 告警可见
    await expect(page.locator('[data-testid="upgrade-releases-error"]')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/UPGRADE_GITHUB_REPO/)).toBeVisible();
  });

  test("在线版本卡片:mock release 数据渲染下拉与拉取按钮", async ({ page }) => {
    await page.route("**/api/upgrade/releases", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            tag: "v2.4.0",
            name: "v2.4.0",
            publishedAt: "2026-06-01T00:00:00Z",
            body: "notes",
            assets: [{ name: "combat-v2.4.0.tar.gz", url: "https://example.com/combat.tar.gz", size: 123456 }],
          },
        ]),
      })
    );
    await page.goto("/system-upgrade");
    await page.waitForLoadState("networkidle");
    await expect(page.locator('[data-testid="upgrade-release-select"]')).toBeVisible();
    await expect(page.locator('[data-testid="upgrade-asset-select"]')).toBeVisible();
    await expect(page.locator('[data-testid="upgrade-fetch-release-btn"]')).toBeVisible();
    await expect(page.getByText(/v2\.4\.0/).first()).toBeVisible();
  });
});
