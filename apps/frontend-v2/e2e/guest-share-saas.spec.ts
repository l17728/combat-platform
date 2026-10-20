import { test, expect } from "@playwright/test";
import { API, waitForTable } from "./helpers";

async function clearAuth(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    localStorage.removeItem("combat-token");
    localStorage.removeItem("combat-user");
    localStorage.removeItem("combat-role");
  });
}

test.describe("免登录体验流程", () => {
  test("点击免登录体验 → token 存入 localStorage → 跳转首页", async ({ page }) => {
    await page.goto("/login");
    await page.evaluate(() => {
      localStorage.removeItem("combat-token");
      localStorage.removeItem("combat-user");
      localStorage.removeItem("combat-role");
    });
    await page.route("**/api/auth/me", (route) =>
      route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "未登录" }) })
    );

    await page.getByText("免登录体验").click();

    await page.waitForURL(/\/(attack|)$/, { timeout: 15000 });
    await expect(page).not.toHaveURL(/\/login/);

    const token = await page.evaluate(() => localStorage.getItem("combat-token"));
    expect(token).toBeTruthy();
  });

  test("免登录用户可以查看仪表盘", async ({ page }) => {
    await page.goto("/login");
    await page.evaluate(() => {
      localStorage.removeItem("combat-token");
      localStorage.removeItem("combat-user");
      localStorage.removeItem("combat-role");
    });

    await page.getByText("免登录体验").click();
    await page.waitForURL(/\/(attack|)$/, { timeout: 15000 });

    await expect(page.getByRole("tab", { name: /作战态势/ })).toBeVisible({ timeout: 10000 });
  });

  test("免登录用户可以查看列表页", async ({ page, request }) => {
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: "游客可见单", 状态: "待响应" },
    });

    await page.goto("/login");
    await page.evaluate(() => {
      localStorage.removeItem("combat-token");
      localStorage.removeItem("combat-user");
      localStorage.removeItem("combat-role");
    });

    await page.getByText("免登录体验").click();
    await page.waitForURL(/\/(attack|)$/, { timeout: 15000 });
    await page.goto("/attack");
    await waitForTable(page);
    await expect(page.getByText("游客可见单")).toBeVisible({ timeout: 10000 });
  });

  test("免登录用户不能访问平台管理", async ({ page }) => {
    await page.goto("/login");
    await page.evaluate(() => {
      localStorage.removeItem("combat-token");
      localStorage.removeItem("combat-user");
      localStorage.removeItem("combat-role");
    });

    await page.getByText("免登录体验").click();
    await page.waitForURL(/\/(attack|)$/, { timeout: 15000 });

    await page.goto("/platform");
    await expect(page).not.toHaveURL(/\/platform/);
  });
});

test.describe("注册流程", () => {
  test("注册新用户 → token 存入 → 跳转首页", async ({ page }) => {
    await page.goto("/login");
    await page.evaluate(() => {
      localStorage.removeItem("combat-token");
      localStorage.removeItem("combat-user");
      localStorage.removeItem("combat-role");
    });

    await page.getByText("注册").click();

    const uniqueName = `e2e_user_${Date.now()}`;
    await page.getByPlaceholder("用户名").fill(uniqueName);
    await page.getByPlaceholder("密码").fill("test123456");

    await page.getByRole("button", { name: /注\s?册/ }).click();

    await page.waitForURL(/\/(attack|)$/, { timeout: 15000 });
    await expect(page).not.toHaveURL(/\/login/);

    const token = await page.evaluate(() => localStorage.getItem("combat-token"));
    expect(token).toBeTruthy();
  });
});

test.describe("分享功能", () => {
  test("访问不存在的分享链接显示错误", async ({ page }) => {
    await page.goto("/s/nonexistent-token-12345");
    await expect(page.getByText(/不存在|已失效|错误/)).toBeVisible({ timeout: 10000 });
  });

  test("创建分享链接后可以访问", async ({ page, request }) => {
    const ticket = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: "分享e2e测试", 状态: "待响应" },
    });
    const ticketId = (await ticket.json()).id;

    const share = await request.post(`${API}/api/share`, {
      data: { entityType: "ticket", entityId: ticketId },
    });
    const shareData = await share.json();

    await page.goto(`/s/${shareData.token}`);
    await expect(page.getByText("分享e2e测试")).toBeVisible({ timeout: 10000 });
  });

  test("带密码的分享链接需要输入密码", async ({ page, request }) => {
    const ticket = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: "密码保护分享", 状态: "待响应" },
    });
    const ticketId = (await ticket.json()).id;

    const share = await request.post(`${API}/api/share`, {
      data: { entityType: "ticket", entityId: ticketId, password: "test123" },
    });
    const shareData = await share.json();

    await page.goto(`/s/${shareData.token}`);
    await expect(page.getByText(/密码/)).toBeVisible({ timeout: 10000 });
  });
});
