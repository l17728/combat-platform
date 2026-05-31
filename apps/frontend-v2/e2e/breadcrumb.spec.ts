import { test, expect } from "@playwright/test";

test.describe("面包屑导航 (BreadcrumbBar)", () => {
  test("dashboard 首页不显示面包屑", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    // 根据组件实现,path '/' 时不渲染
    await expect(page.locator('[data-testid="breadcrumb-bar"]')).toHaveCount(0);
  });

  test("攻关作战台 → 三级面包屑(首页 / 攻关管理 / 攻关作战台)", async ({ page }) => {
    await page.goto("/attack");
    await page.waitForLoadState("domcontentloaded");
    const bar = page.locator('[data-testid="breadcrumb-bar"]');
    await expect(bar).toBeVisible();
    await expect(bar).toContainText("首页");
    await expect(bar).toContainText("攻关管理");
    await expect(bar).toContainText("攻关作战台");
  });

  test("贡献录入 → 首页 / 人员与荣誉 / 贡献录入", async ({ page }) => {
    await page.goto("/contributions");
    await page.waitForLoadState("domcontentloaded");
    const bar = page.locator('[data-testid="breadcrumb-bar"]');
    await expect(bar).toContainText("人员与荣誉");
    await expect(bar).toContainText("贡献录入");
  });

  test("通知中心 → 首页 / 通知中心", async ({ page }) => {
    await page.goto("/notifications");
    await page.waitForLoadState("domcontentloaded");
    const bar = page.locator('[data-testid="breadcrumb-bar"]');
    await expect(bar).toContainText("通知中心");
  });

  test("系统管理 → 数据导入/导出三段", async ({ page }) => {
    await page.goto("/import");
    await page.waitForLoadState("domcontentloaded");
    const bar = page.locator('[data-testid="breadcrumb-bar"]');
    await expect(bar).toContainText("系统管理");
    await expect(bar).toContainText("数据导入/导出");
  });

  test("点击中间项可跳回上级", async ({ page }) => {
    // /daily-report 面包屑中的「首页」是可点击的链接
    await page.goto("/daily-report");
    await page.waitForLoadState("domcontentloaded");
    const bar = page.locator('[data-testid="breadcrumb-bar"]');
    await bar.getByRole("link", { name: /首页/ }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});
