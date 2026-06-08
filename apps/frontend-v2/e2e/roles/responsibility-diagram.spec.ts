import { test, expect } from "@playwright/test";
import { adminLogin, injectAuth, goTo, API } from "./helpers";

test.describe("责任图谱 — admin", () => {
  let auth: Awaited<ReturnType<typeof adminLogin>>;

  test.beforeAll(async ({ request }) => {
    auth = await adminLogin(request);
  });

  test.beforeEach(async ({ page }) => {
    await injectAuth(page, auth);
    await goTo(page, "/responsibility");
  });

  test("页面渲染正确", async ({ page }) => {
    await expect(page.getByText("责任图谱")).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("button", { name: /全屏/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /刷新/ })).toBeVisible();
  });

  test("统计概览可见", async ({ page }) => {
    await page.waitForTimeout(2000);
    const statsCards = page.locator(".ant-statistic");
    const count = await statsCards.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test("Mermaid 图表区域存在", async ({ page }) => {
    await page.waitForTimeout(3000);
    const svgContainer = page.locator("svg").first();
    const hasSvg = await svgContainer.isVisible({ timeout: 5000 }).catch(() => false);
    const hasPre = await page.locator("pre").first().isVisible({ timeout: 2000 }).catch(() => false);
    expect(hasSvg || hasPre).toBeTruthy();
  });

  test("API: 获取责任图谱", async ({ request }) => {
    const headers = { Authorization: `Bearer ${auth.token}` };
    const res = await request.get(`${API}/api/responsibility/diagram`, { headers });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveProperty("mermaid");
    expect(data).toHaveProperty("nodeCount");
    expect(data).toHaveProperty("edgeCount");
    expect(typeof data.mermaid).toBe("string");
  });
});
