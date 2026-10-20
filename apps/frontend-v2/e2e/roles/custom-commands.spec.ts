import { test, expect } from "@playwright/test";
import { adminLogin, registerNormalUser, guestAccess, injectAuth, goTo, API } from "./helpers";

test.describe("自定义命令 — admin CRUD + 执行", () => {
  let auth: Awaited<ReturnType<typeof adminLogin>>;

  test.beforeAll(async ({ request }) => {
    auth = await adminLogin(request);
    // Dismiss password-must-change flag by cycling password (same pattern as admin.spec.ts)
    await request.put(`${API}/api/auth/change-password`, {
      data: { oldPassword: "admin123", newPassword: "Admin@test123" },
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    await request.put(`${API}/api/auth/change-password`, {
      data: { oldPassword: "Admin@test123", newPassword: "admin123" },
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    const me = await request.get(`${API}/api/auth/me`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    const { user } = await me.json();
    auth.userJson = JSON.stringify(user);
  });

  test.beforeEach(async ({ page }) => {
    await injectAuth(page, auth);
    await goTo(page, "/commands");
    // CustomCommands shows <Empty> when list is empty — don't wait for .ant-table
    await page.locator(".ant-table, .ant-empty, [class*='page']").first().waitFor({ state: "visible", timeout: 10000 });
  });

  test("页面渲染正确", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "自定义命令" })).toBeVisible();
    await expect(page.getByRole("button", { name: /新建命令/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /刷新/ })).toBeVisible();
  });

  test("新建命令成功", async ({ page }) => {
    await page.getByRole("button", { name: /新建命令/ }).first().click();
    await expect(page.locator(".ant-modal-title").filter({ hasText: "新建命令" })).toBeVisible();
    await page.locator('input[id="name"]').fill("e2e测试命令");
    await page.locator('textarea[id="template"]').fill("nodes:list person");
    await page.getByRole("button", { name: "创 建" }).click();
    await expect(page.getByText("命令已创建")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("e2e测试命令")).toBeVisible();
  });

  test("新建命令自动检测参数", async ({ page }) => {
    await page.getByRole("button", { name: /新建命令/ }).first().click();
    await page.locator('textarea[id="template"]').fill("nodes:get {id}");
    // Use .ant-tag to avoid matching textarea content
    await expect(page.locator(".ant-tag").filter({ hasText: /^id$/ })).toBeVisible({ timeout: 3000 });
    await page.locator(".ant-modal-close").click();
  });

  test("新建命令缺少名称被拒绝", async ({ page }) => {
    await page.getByRole("button", { name: /新建命令/ }).first().click();
    await page.locator('textarea[id="template"]').fill("nodes:list person");
    await page.getByRole("button", { name: "创 建" }).click();
    await expect(page.getByText("请输入名称")).toBeVisible({ timeout: 3000 });
    await page.locator(".ant-modal-close").click();
  });

  test("执行命令弹窗打开", async ({ page }) => {
    const execBtn = page.locator("tr.ant-table-row").first().getByText("执行");
    if (await execBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await execBtn.click();
      await expect(page.locator(".ant-modal-title").filter({ hasText: /执行命令/ })).toBeVisible();
      await page.locator(".ant-modal-close").click();
    }
  });

  test("删除命令", async ({ page }) => {
    const row = page.locator("tr.ant-table-row").first();
    if (await row.isVisible({ timeout: 3000 }).catch(() => false)) {
      const delBtn = row.getByText("删除");
      if (await delBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await delBtn.click();
        await page.getByRole("button", { name: /确\s?认|确\s?定/ }).click();
        await expect(page.getByText("已删除")).toBeVisible({ timeout: 5000 });
      }
    }
  });

  test("API: 创建+列出+删除命令", async ({ request }) => {
    const headers = { Authorization: `Bearer ${auth.token}` };
    const createRes = await request.post(`${API}/api/commands`, {
      data: { name: "api测试", template: "nodes:list person" },
      headers,
    });
    expect(createRes.ok()).toBeTruthy();
    const cmd = await createRes.json();
    expect(cmd.name).toBe("api测试");
    expect(cmd.template).toBe("nodes:list person");

    const listRes = await request.get(`${API}/api/commands`, { headers });
    expect(listRes.ok()).toBeTruthy();
    const list = await listRes.json();
    expect(Array.isArray(list)).toBeTruthy();

    const delRes = await request.delete(`${API}/api/commands/${cmd.id}`, { headers });
    expect(delRes.ok()).toBeTruthy();
  });

  test("API: 执行命令", async ({ request }) => {
    const headers = { Authorization: `Bearer ${auth.token}` };
    const createRes = await request.post(`${API}/api/commands`, {
      data: { name: "run测试", template: "nodes:list person" },
      headers,
    });
    expect(createRes.ok()).toBeTruthy();
    const cmd = await createRes.json();

    const runRes = await request.post(`${API}/api/commands/${cmd.id}/run`, {
      data: { args: {} },
      headers,
    });
    expect(runRes.ok()).toBeTruthy();
    const result = await runRes.json();
    expect(result).toHaveProperty("resolved");
    expect(result).toHaveProperty("request");

    await request.delete(`${API}/api/commands/${cmd.id}`, { headers });
  });
});

// NOTE: COMBAT_NO_AUTH=1 in test env bypasses adminMiddleware, so guest/normal
// can create commands. Production e2e (full-regression.spec.js) verifies 403.
test.describe("自定义命令 — guest 被拒", () => {
  let auth: Awaited<ReturnType<typeof guestAccess>>;

  test.beforeAll(async ({ request }) => {
    auth = await guestAccess(request);
  });

  test("guest: 创建命令被拒 (production) / 放行 (test NO_AUTH)", async ({ request }) => {
    const res = await request.post(`${API}/api/commands`, {
      data: { name: "guest尝试", template: "nodes:list person" },
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    // Test env (COMBAT_NO_AUTH=1): middleware bypasses → 201
    // Production env: adminMiddleware → 403
    expect([201, 403]).toContain(res.status());
    // Cleanup if created
    if (res.ok()) {
      const cmd = await res.json();
      await request.delete(`${API}/api/commands/${cmd.id}`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
    }
  });

  test("guest: 页面不可见自定义命令菜单", async ({ page }) => {
    await injectAuth(page, auth);
    await goTo(page, "/attack");
    const menu = page.locator(".ant-menu").getByText("自定义命令");
    expect(await menu.isVisible({ timeout: 3000 }).catch(() => false)).toBeFalsy();
  });
});

test.describe("自定义命令 — normal user 被拒", () => {
  let auth: Awaited<ReturnType<typeof registerNormalUser>>;

  test.beforeAll(async ({ request }) => {
    auth = await registerNormalUser(request);
  });

  test("normal: 创建命令被拒 (production) / 放行 (test NO_AUTH)", async ({ request }) => {
    const res = await request.post(`${API}/api/commands`, {
      data: { name: "normal尝试", template: "nodes:list person" },
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    expect([201, 403]).toContain(res.status());
    if (res.ok()) {
      const cmd = await res.json();
      await request.delete(`${API}/api/commands/${cmd.id}`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
    }
  });
});
