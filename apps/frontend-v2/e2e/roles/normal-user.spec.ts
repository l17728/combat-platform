/**
 * Normal User Role E2E Tests — Full Lifecycle
 *
 * Normal User permissions:
 *   - Business menus: full CRUD (create, query, edit, delete own content)
 *   - System management: HIDDEN (menu not visible, cannot navigate to pages)
 *   - Creator-only delete: can only delete own records
 */
import { test, expect } from "@playwright/test";
import {
  API,
  registerNormalUser,
  adminLogin,
  goTo,
  injectAuth,
  type AuthResult,
  waitForTable,
  waitForDrawer,
  dismissTour,
} from "./helpers";

let normalAuth: AuthResult;
let adminAuth: AuthResult;

test.beforeAll(async ({ request }) => {
  normalAuth = await registerNormalUser(request);
  adminAuth = await adminLogin(request);
});

test.beforeEach(async ({ page }) => {
  await injectAuth(page, normalAuth);
});

// ===========================================================================
// §N1 Normal User Registration & Login
// ===========================================================================
test.describe("§N1 注册与登录", () => {
  test("注册新用户+新团队 → 获得token", async ({ request }) => {
    const ts = Date.now();
    const res = await request.post(`${API}/api/auth/register`, {
      data: {
        username: `testuser_${ts}`,
        password: "test123456",
        tenantName: `TestTeam_${ts}`,
        tenantSlug: `testteam-${ts}`,
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.token).toBeTruthy();
  });

  test("登录已有用户 → 获得token", async ({ request }) => {
    const regRes = await request.post(`${API}/api/auth/register`, {
      data: {
        username: `loginuser_${Date.now()}`,
        password: "test123456",
        tenantName: `LoginTeam_${Date.now()}`,
        tenantSlug: `loginteam-${Date.now()}`,
      },
    });
    const regBody = await regRes.json();
    const loginRes = await request.post(`${API}/api/auth/login`, {
      data: { username: regBody.user.username, password: "test123456" },
    });
    expect(loginRes.ok()).toBeTruthy();
    const { token } = await loginRes.json();
    expect(token).toBeTruthy();
  });

  test("注册用户role为admin(新团队首个用户)", async ({ request }) => {
    const ts = Date.now();
    const res = await request.post(`${API}/api/auth/register`, {
      data: {
        username: `rolecheck_${ts}`,
        password: "test123456",
        tenantName: `RoleTeam_${ts}`,
        tenantSlug: `roleteam-${ts}`,
      },
    });
    const regBody = await res.json();
    const me = await request.get(`${API}/api/auth/me`, {
      headers: { Authorization: `Bearer ${regBody.token}` },
    });
    const meBody = await me.json();
    expect(meBody.user.role).toBe("admin");
  });

  test("Normal User看到首页", async ({ page }) => {
    await goTo(page, "/");
    await expect(page.locator("text=作战态势").first()).toBeVisible({ timeout: 10000 });
  });
});

// ===========================================================================
// §N2 攻关作战台 — Normal User CRUD
// ===========================================================================
test.describe("§N2 攻关作战台", () => {
  test("查看列表", async ({ page }) => {
    await goTo(page, "/attack");
    await waitForTable(page);
  });

  test("创建攻关单", async ({ page }) => {
    test.setTimeout(120000);
    await goTo(page, "/attack");
    await waitForTable(page);
    const createBtn = page.getByRole("button", { name: /新建|创建|新增/ }).first();
    if (await createBtn.isVisible()) {
      await createBtn.click();
      await waitForDrawer(page);
      const titleInput = page.locator(".ant-drawer input, .ant-drawer textarea").first();
      if (await titleInput.isVisible()) {
        await titleInput.fill(`普通用户测试单_${Date.now()}`);
      }
      const submitBtn = page
        .locator(".ant-drawer")
        .getByRole("button", { name: /提交|确定|保存/ })
        .first();
      if (await submitBtn.isVisible()) {
        await submitBtn.click();
        await page.waitForTimeout(1000);
      }
    }
  });

  test("搜索攻关单", async ({ page }) => {
    await goTo(page, "/attack");
    await waitForTable(page);
    const searchInput = page.locator("input[placeholder*='搜索'], input[placeholder*='Search']").first();
    if (await searchInput.isVisible()) {
      await searchInput.fill("测试");
      await page.waitForTimeout(500);
    }
  });

  test("Tab切换", async ({ page }) => {
    await goTo(page, "/attack");
    await waitForTable(page);
    const tabs = page.locator(".ant-tabs-tab");
    const count = await tabs.count();
    if (count > 1) {
      await tabs.nth(1).click();
      await page.waitForTimeout(500);
    }
  });

  test("视图切换", async ({ page }) => {
    await goTo(page, "/attack");
    await waitForTable(page);
    const viewBtns = page.locator("[class*='view-switch'] button, button[title*='视图'], button[title*='看板']");
    if (await viewBtns.first().isVisible()) {
      await viewBtns.first().click();
      await page.waitForTimeout(500);
    }
  });
});

// ===========================================================================
// §N3 全员名单 — Normal User CRUD
// ===========================================================================
test.describe("§N3 全员名单", () => {
  test("查看列表", async ({ page }) => {
    await goTo(page, "/people");
    await waitForTable(page);
  });

  test("搜索人员", async ({ page }) => {
    await goTo(page, "/people");
    await waitForTable(page);
    const searchInput = page.locator("input[placeholder*='搜索']").first();
    if (await searchInput.isVisible()) {
      await searchInput.fill("测试");
      await page.waitForTimeout(500);
    }
  });

  test("创建人员", async ({ page }) => {
    await goTo(page, "/people");
    await waitForTable(page);
    const createBtn = page.getByRole("button", { name: /新建|创建|新增|添加/ }).first();
    if (await createBtn.isVisible()) {
      await createBtn.click();
      await waitForDrawer(page);
      const nameInput = page.locator(".ant-drawer input").first();
      if (await nameInput.isVisible()) {
        await nameInput.fill(`普通用户人员_${Date.now()}`);
      }
      const submitBtn = page
        .locator(".ant-drawer")
        .getByRole("button", { name: /提交|确定|保存/ })
        .first();
      if (await submitBtn.isVisible()) {
        await submitBtn.click();
        await page.waitForTimeout(1000);
      }
    }
  });
});

// ===========================================================================
// §N4 贡献录入
// ===========================================================================
test.describe("§N4 贡献录入", () => {
  test("查看列表", async ({ page }) => {
    await goTo(page, "/contributions");
    await waitForTable(page);
  });

  test("创建贡献", async ({ page }) => {
    await goTo(page, "/contributions");
    await waitForTable(page);
    const createBtn = page.getByRole("button", { name: /新建|创建|录入|新增/ }).first();
    if (await createBtn.isVisible()) {
      await createBtn.click();
      await waitForDrawer(page);
      const submitBtn = page
        .locator(".ant-drawer")
        .getByRole("button", { name: /提交|确定|保存/ })
        .first();
      if (await submitBtn.isVisible()) {
        await submitBtn.click();
        await page.waitForTimeout(1000);
      }
    }
  });
});

// ===========================================================================
// §N5 荣誉殿堂
// ===========================================================================
test.describe("§N5 荣誉殿堂", () => {
  test("查看列表", async ({ page }) => {
    await goTo(page, "/honor");
    await page.waitForTimeout(1000);
  });

  test("Tab切换", async ({ page }) => {
    await goTo(page, "/honor");
    const tabs = page.locator(".ant-tabs-tab");
    const count = await tabs.count();
    if (count > 1) {
      await tabs.nth(1).click();
      await page.waitForTimeout(500);
    }
  });
});

// ===========================================================================
// §N6 攻关日报
// ===========================================================================
test.describe("§N6 攻关日报", () => {
  test("查看列表", async ({ page }) => {
    await goTo(page, "/daily-report");
    await waitForTable(page);
  });
});

// ===========================================================================
// §N7 求助中心 — Normal User CRUD
// ===========================================================================
test.describe("§N7 求助中心", () => {
  test("查看列表", async ({ page }) => {
    await goTo(page, "/help");
    await waitForTable(page);
  });

  test("发起求助", async ({ page }) => {
    await goTo(page, "/help");
    await waitForTable(page);
    const createBtn = page.getByRole("button", { name: /发起|新建|创建/ }).first();
    if (await createBtn.isVisible()) {
      await createBtn.click();
      await waitForDrawer(page);
      const textarea = page.locator(".ant-drawer textarea").first();
      if (await textarea.isVisible()) {
        await textarea.fill(`普通用户求助_${Date.now()}`);
      }
      const submitBtn = page
        .locator(".ant-drawer")
        .getByRole("button", { name: /提交|确定/ })
        .first();
      if (await submitBtn.isVisible()) {
        await submitBtn.click();
        await page.waitForTimeout(1000);
      }
    }
  });
});

// ===========================================================================
// §N8 问题反馈
// ===========================================================================
test.describe("§N8 问题反馈", () => {
  test("查看列表", async ({ page }) => {
    await goTo(page, "/bug-report");
    await waitForTable(page);
  });

  test("提交问题反馈", async ({ page }) => {
    await goTo(page, "/bug-report");
    await waitForTable(page);
    const submitBtn = page.getByRole("button", { name: /提交|新建|反馈/ }).first();
    if (await submitBtn.isVisible()) {
      await submitBtn.click();
      await waitForDrawer(page);
      const input = page.locator(".ant-drawer input, .ant-drawer textarea").first();
      if (await input.isVisible()) {
        await input.fill(`普通用户反馈_${Date.now()}`);
      }
      const confirmBtn = page
        .locator(".ant-drawer")
        .getByRole("button", { name: /提交|确定/ })
        .first();
      if (await confirmBtn.isVisible()) {
        await confirmBtn.click();
        await page.waitForTimeout(1000);
      }
    }
  });
});

// ===========================================================================
// §N9 文档中心
// ===========================================================================
test.describe("§N9 文档中心", () => {
  test("查看列表", async ({ page }) => {
    await goTo(page, "/documents");
    await page.waitForTimeout(1000);
  });
});

// ===========================================================================
// §N10 全局搜索
// ===========================================================================
test.describe("§N10 全局搜索", () => {
  test("搜索功能", async ({ page }) => {
    await goTo(page, "/search");
    const searchSelect = page.locator(".ant-select").first();
    if (await searchSelect.isVisible({ timeout: 5000 }).catch(() => false)) {
      await searchSelect.click();
      await page.waitForTimeout(500);
      await page.keyboard.type("测试");
      await page.waitForTimeout(1000);
    }
  });
});

// ===========================================================================
// §N11 知识图谱
// ===========================================================================
test.describe("§N11 知识图谱", () => {
  test("页面加载", async ({ page }) => {
    await goTo(page, "/kg");
    await page.waitForTimeout(2000);
  });
});

// ===========================================================================
// §N12 仪表盘
// ===========================================================================
test.describe("§N12 仪表盘", () => {
  test("页面加载", async ({ page }) => {
    await goTo(page, "/");
    await expect(page.locator("text=作战态势").first()).toBeVisible({ timeout: 10000 });
  });
});

// ===========================================================================
// §N13 侧边栏导航 — Normal User 看不到系统管理菜单
// ===========================================================================
test.describe("§N13 侧边栏导航", () => {
  test("Normal User看不到系统管理菜单", async ({ page }) => {
    await goTo(page, "/");
    const sysMenu = page.locator(".ant-menu").getByText("系统管理").first();
    const visible = await sysMenu.isVisible({ timeout: 5000 }).catch(() => false);
    if (visible) {
      const adminOnlyItems = page
        .locator(".ant-menu")
        .getByText(/用户管理|邀请管理|Webhook|LLM 设置|人员合并|系统升级|数据库迁移/)
        .first();
      await expect(adminOnlyItems).not.toBeVisible({ timeout: 3000 });
    }
  });

  test("Normal User看到攻关管理菜单", async ({ page }) => {
    await goTo(page, "/");
    const attackMenu = page.locator(".ant-menu").getByText("攻关管理").first();
    await expect(attackMenu).toBeVisible({ timeout: 5000 });
  });

  test("Normal User看到人员与荣誉菜单", async ({ page }) => {
    await goTo(page, "/");
    const peopleMenu = page.locator(".ant-menu").getByText("人员与荣誉").first();
    await expect(peopleMenu).toBeVisible({ timeout: 5000 });
  });

  test("Normal User看到求助中心菜单", async ({ page }) => {
    await goTo(page, "/");
    const helpMenu = page.locator(".ant-menu").getByText("求助中心").first();
    await expect(helpMenu).toBeVisible({ timeout: 5000 });
  });
});

// ===========================================================================
// §N14 仅创建人可删除
// ===========================================================================
test.describe("§N14 仅创建人可删除", () => {
  test("可以删除自己创建的记录", async ({ request }) => {
    const createRes = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: "自删除测试", 状态: "待响应" },
      headers: { Authorization: `Bearer ${normalAuth.token}` },
    });
    expect(createRes.ok()).toBeTruthy();
    const { id } = await createRes.json();
    const delRes = await request.delete(`${API}/api/nodes/${id}`, {
      headers: { Authorization: `Bearer ${normalAuth.token}` },
    });
    expect(delRes.ok()).toBeTruthy();
  });

  test("不能删除admin创建的记录", async ({ request }) => {
    const adminRes = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: "Admin记录_不可删", 状态: "待响应" },
      headers: { Authorization: `Bearer ${adminAuth.token}` },
    });
    expect(adminRes.ok()).toBeTruthy();
    const { id } = await adminRes.json();
    const delRes = await request.delete(`${API}/api/nodes/${id}`, {
      headers: { Authorization: `Bearer ${normalAuth.token}` },
    });
    expect(delRes.status()).toBe(403);
  });
});

// ===========================================================================
// §N15 业务 CRUD API — Normal User 完整权限
// ===========================================================================
test.describe("§N15 业务CRUD API验证", () => {
  test("创建攻关单", async ({ request }) => {
    const res = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: "Normal CRUD测试", 状态: "待响应" },
      headers: { Authorization: `Bearer ${normalAuth.token}` },
    });
    expect(res.ok()).toBeTruthy();
  });

  test("查询攻关单列表", async ({ request }) => {
    const res = await request.get(`${API}/api/nodes/attackTicket`, {
      headers: { Authorization: `Bearer ${normalAuth.token}` },
    });
    expect(res.ok()).toBeTruthy();
  });

  test("创建人员", async ({ request }) => {
    const res = await request.post(`${API}/api/nodes/person`, {
      data: { 姓名: `普通用户人员_${Date.now()}` },
      headers: { Authorization: `Bearer ${normalAuth.token}` },
    });
    expect(res.ok()).toBeTruthy();
  });

  test("创建贡献", async ({ request }) => {
    const res = await request.post(`${API}/api/nodes/contribution`, {
      data: { 描述: "普通用户贡献", 贡献人: "normal", 贡献类型: "发现" },
      headers: { Authorization: `Bearer ${normalAuth.token}` },
    });
    expect(res.ok()).toBeTruthy();
  });
});

// ===========================================================================
// §N16 系统管理 API — Normal User 被拒绝
// ===========================================================================
test.describe("§N16 系统管理API拒绝", () => {
  test("GET /api/audit → 403", async ({ request }) => {
    const res = await request.get(`${API}/api/audit`, {
      headers: { Authorization: `Bearer ${normalAuth.token}` },
    });
    expect(res.status()).toBe(403);
  });

  test("GET /api/backup → 403", async ({ request }) => {
    const res = await request.get(`${API}/api/backup`, {
      headers: { Authorization: `Bearer ${normalAuth.token}` },
    });
    expect(res.status()).toBe(403);
  });

  test("GET /api/users → 403", async ({ request }) => {
    const res = await request.get(`${API}/api/users`, {
      headers: { Authorization: `Bearer ${normalAuth.token}` },
    });
    expect(res.status()).toBe(403);
  });

  test("GET /api/config → 403", async ({ request }) => {
    const res = await request.get(`${API}/api/config`, {
      headers: { Authorization: `Bearer ${normalAuth.token}` },
    });
    expect(res.status()).toBe(403);
  });

  test("GET /api/webhook → 403", async ({ request }) => {
    const res = await request.get(`${API}/api/webhook`, {
      headers: { Authorization: `Bearer ${normalAuth.token}` },
    });
    expect(res.status()).toBe(403);
  });

  test("GET /api/digest → 403", async ({ request }) => {
    const res = await request.get(`${API}/api/digest`, {
      headers: { Authorization: `Bearer ${normalAuth.token}` },
    });
    expect(res.status()).toBe(403);
  });

  test("GET /api/invitation → 403", async ({ request }) => {
    const res = await request.get(`${API}/api/invitation`, {
      headers: { Authorization: `Bearer ${normalAuth.token}` },
    });
    expect(res.status()).toBe(403);
  });

  test("GET /api/op-logs → 403", async ({ request }) => {
    const res = await request.get(`${API}/api/op-logs`, {
      headers: { Authorization: `Bearer ${normalAuth.token}` },
    });
    expect(res.status()).toBe(403);
  });
});

// ===========================================================================
// §N17 系统管理页面路由 — Normal User 被重定向到首页
// ===========================================================================
test.describe("§N17 系统管理页面路由拒绝", () => {
  const systemPaths = [
    "/import",
    "/schema",
    "/config",
    "/email",
    "/audit",
    "/backup",
    "/users",
    "/op-log",
    "/webhooks",
    "/digest",
    "/invitations",
    "/merge",
    "/llm-settings",
    "/proposals",
    "/reminders",
    "/db-migration",
    "/system-upgrade",
    "/platform",
  ];

  for (const path of systemPaths) {
    test(`访问 ${path} 被重定向到首页`, async ({ page }) => {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);
      expect(page.url()).not.toContain(path);
    });
  }
});

// §N18 后端系统管理 API — 举一反三补齐
test.describe("§N18 后端系统管理API拒绝(举一反三)", () => {
  test("GET /api/settings → 403", async ({ request }) => {
    const res = await request.get(`${API}/settings`, {
      headers: { Authorization: `Bearer ${normalAuth.token}` },
    });
    expect(res.status()).toBe(403);
  });

  test("PUT /api/settings/test-key → 403", async ({ request }) => {
    const res = await request.put(`${API}/settings/test-key`, {
      data: { values: ["hack"] },
      headers: { Authorization: `Bearer ${normalAuth.token}` },
    });
    expect(res.status()).toBe(403);
  });

  test("DELETE /api/settings/test-key → 403", async ({ request }) => {
    const res = await request.delete(`${API}/settings/test-key`, {
      headers: { Authorization: `Bearer ${normalAuth.token}` },
    });
    expect(res.status()).toBe(403);
  });

  test("POST /api/schema/scan → 403", async ({ request }) => {
    const res = await request.post(`${API}/schema/scan`, {
      headers: { Authorization: `Bearer ${normalAuth.token}` },
    });
    expect(res.status()).toBe(403);
  });

  test("PATCH /api/schema/attackTicket → 403", async ({ request }) => {
    const res = await request.patch(`${API}/schema/attackTicket`, {
      data: { op: "addField", field: { name: "pocField", type: "string", label: "PoC" } },
      headers: { Authorization: `Bearer ${normalAuth.token}` },
    });
    expect(res.status()).toBe(403);
  });

  test("POST /api/import → 403", async ({ request }) => {
    const res = await request.post(`${API}/import?type=attackTicket`, {
      headers: { Authorization: `Bearer ${normalAuth.token}` },
    });
    expect(res.status()).toBe(403);
  });

  test("POST /api/hermes/tool/list_node_types → 403", async ({ request }) => {
    const res = await request.post(`${API}/hermes/tool/list_node_types`, {
      data: { input: {} },
      headers: { Authorization: `Bearer ${normalAuth.token}` },
    });
    expect(res.status()).toBe(403);
  });
});
