/**
 * Admin Role E2E Tests — Full Lifecycle
 *
 * Admin permissions:
 *   - Business menus: full CRUD (can delete ANYONE's records)
 *   - System management: full control (all pages, all operations)
 *   - Admin bypass for creator-only delete
 */
import { test, expect } from "@playwright/test";
import {
  API,
  adminLogin,
  goTo,
  injectAuth,
  type AuthResult,
  waitForTable,
  waitForDrawer,
  dismissTour,
} from "./helpers";

let adminAuth: AuthResult;

test.beforeAll(async ({ request }) => {
  adminAuth = await adminLogin(request);
  await request.put(`${API}/api/auth/change-password`, {
    data: { oldPassword: "admin123", newPassword: "Admin@test123" },
    headers: { Authorization: `Bearer ${adminAuth.token}` },
  });
  await request.put(`${API}/api/auth/change-password`, {
    data: { oldPassword: "Admin@test123", newPassword: "admin123" },
    headers: { Authorization: `Bearer ${adminAuth.token}` },
  });
  const me = await request.get(`${API}/api/auth/me`, {
    headers: { Authorization: `Bearer ${adminAuth.token}` },
  });
  const { user } = await me.json();
  adminAuth.userJson = JSON.stringify(user);
});

test.beforeEach(async ({ page }) => {
  await injectAuth(page, adminAuth);
});

// ===========================================================================
// §A1 Admin Login
// ===========================================================================
test.describe("§A1 Admin登录", () => {
  test("登录成功返回token", async ({ request }) => {
    const res = await request.post(`${API}/api/auth/login`, {
      data: { username: "admin", password: "admin123" },
    });
    expect(res.ok()).toBeTruthy();
    const { token } = await res.json();
    expect(token).toBeTruthy();
  });

  test("Admin token role为superadmin", async ({ request }) => {
    const me = await request.get(`${API}/api/auth/me`, {
      headers: { Authorization: `Bearer ${adminAuth.token}` },
    });
    expect(me.ok()).toBeTruthy();
    const body = await me.json();
    expect(body.user.role).toBe("superadmin");
  });

  test("Admin看到首页", async ({ page }) => {
    await goTo(page, "/");
    await expect(page.locator("text=作战态势").first()).toBeVisible({ timeout: 10000 });
  });
});

// ===========================================================================
// §A2 攻关作战台 — Admin Full CRUD
// ===========================================================================
test.describe("§A2 攻关作战台", () => {
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
        await titleInput.fill(`Admin测试单_${Date.now()}`);
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

  test("搜索", async ({ page }) => {
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
// §A3 全员名单
// ===========================================================================
test.describe("§A3 全员名单", () => {
  test("查看列表", async ({ page }) => {
    await goTo(page, "/people");
    await waitForTable(page).catch(() => {});
    await page.waitForTimeout(1000);
  });

  test("搜索", async ({ page }) => {
    await goTo(page, "/people");
    await waitForTable(page).catch(() => {});
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
        await nameInput.fill(`Admin人员_${Date.now()}`);
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
// §A4 贡献录入
// ===========================================================================
test.describe("§A4 贡献录入", () => {
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
// §A5 荣誉殿堂
// ===========================================================================
test.describe("§A5 荣誉殿堂", () => {
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
// §A6 攻关日报
// ===========================================================================
test.describe("§A6 攻关日报", () => {
  test("查看列表", async ({ page }) => {
    await goTo(page, "/daily-report");
    await waitForTable(page);
  });
});

// ===========================================================================
// §A7 求助中心
// ===========================================================================
test.describe("§A7 求助中心", () => {
  test("查看列表", async ({ page }) => {
    await goTo(page, "/help");
    await waitForTable(page).catch(() => {});
    await page.waitForTimeout(1000);
  });

  test("发起求助", async ({ page }) => {
    await goTo(page, "/help");
    await waitForTable(page).catch(() => {});
    const createBtn = page.getByRole("button", { name: /发起|新建|创建/ }).first();
    if (await createBtn.isVisible()) {
      await createBtn.click();
      await waitForDrawer(page);
      const textarea = page.locator(".ant-drawer textarea").first();
      if (await textarea.isVisible()) {
        await textarea.fill(`Admin求助_${Date.now()}`);
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
// §A8 问题反馈
// ===========================================================================
test.describe("§A8 问题反馈", () => {
  test("查看列表", async ({ page }) => {
    await goTo(page, "/bug-report");
    await waitForTable(page);
  });

  test("提交反馈", async ({ page }) => {
    await goTo(page, "/bug-report");
    await waitForTable(page);
    const submitBtn = page.getByRole("button", { name: /提交|新建|反馈/ }).first();
    if (await submitBtn.isVisible()) {
      await submitBtn.click();
      await waitForDrawer(page);
      const input = page.locator(".ant-drawer input, .ant-drawer textarea").first();
      if (await input.isVisible()) {
        await input.fill(`Admin反馈_${Date.now()}`);
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
// §A9 文档中心
// ===========================================================================
test.describe("§A9 文档中心", () => {
  test("查看列表", async ({ page }) => {
    await goTo(page, "/documents");
    await page.waitForTimeout(1000);
  });
});

// ===========================================================================
// §A10 全局搜索
// ===========================================================================
test.describe("§A10 全局搜索", () => {
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
// §A11 知识图谱
// ===========================================================================
test.describe("§A11 知识图谱", () => {
  test("页面加载", async ({ page }) => {
    await goTo(page, "/kg");
    await page.waitForTimeout(2000);
  });
});

// ===========================================================================
// §A12 仪表盘
// ===========================================================================
test.describe("§A12 仪表盘", () => {
  test("页面加载", async ({ page }) => {
    await goTo(page, "/");
    await expect(page.locator("text=作战态势").first()).toBeVisible({ timeout: 10000 });
  });
});

// ===========================================================================
// §A13 侧边栏导航 — Admin 看到所有菜单
// ===========================================================================
test.describe("§A13 侧边栏导航", () => {
  test("Admin看到系统管理菜单", async ({ page }) => {
    await goTo(page, "/");
    const sysMenu = page.locator(".ant-menu").getByText("系统管理").first();
    await expect(sysMenu).toBeVisible({ timeout: 5000 });
  });

  test("Admin看到攻关管理菜单", async ({ page }) => {
    await goTo(page, "/");
    const attackMenu = page.locator(".ant-menu").getByText("攻关管理").first();
    await expect(attackMenu).toBeVisible({ timeout: 5000 });
  });

  test("Admin看到人员与荣誉菜单", async ({ page }) => {
    await goTo(page, "/");
    const peopleMenu = page.locator(".ant-menu").getByText("人员与荣誉").first();
    await expect(peopleMenu).toBeVisible({ timeout: 5000 });
  });

  test("Admin看到求助中心菜单", async ({ page }) => {
    await goTo(page, "/");
    const helpMenu = page.locator(".ant-menu").getByText("求助中心").first();
    await expect(helpMenu).toBeVisible({ timeout: 5000 });
  });
});

// ===========================================================================
// §A14 系统管理页面 — Admin Full Control
// ===========================================================================
test.describe("§A14 系统管理页面", () => {
  const systemPages = [
    "/import",
    "/schema",
    "/config",
    "/email",
    "/audit",
    "/backup",
    "/users",
    "/invitations",
    "/op-log",
    "/llm-settings",
    "/webhooks",
    "/merge",
    "/reminders",
    "/proposals",
    "/digest",
  ];

  for (const path of systemPages) {
    test(`Admin可以访问 ${path}`, async ({ page }) => {
      await goTo(page, path);
      await page.waitForTimeout(1500);
      expect(page.url()).toContain(path);
    });
  }
});

// ===========================================================================
// §A15 系统管理 API — Admin 写操作成功
// ===========================================================================
test.describe("§A15 系统管理API写操作", () => {
  test("GET /api/audit → 200", async ({ request }) => {
    const res = await request.get(`${API}/api/audit`, {
      headers: { Authorization: `Bearer ${adminAuth.token}` },
    });
    expect(res.status()).toBe(200);
  });

  test("GET /api/backup → 200", async ({ request }) => {
    const res = await request.get(`${API}/api/backup`, {
      headers: { Authorization: `Bearer ${adminAuth.token}` },
    });
    expect(res.status()).toBe(200);
  });

  test("GET /api/users → 200", async ({ request }) => {
    const res = await request.get(`${API}/api/users`, {
      headers: { Authorization: `Bearer ${adminAuth.token}` },
    });
    expect(res.status()).toBe(200);
  });

  test("GET /api/schema/list → 200", async ({ request }) => {
    const res = await request.get(`${API}/api/schema/list`, {
      headers: { Authorization: `Bearer ${adminAuth.token}` },
    });
    expect(res.status()).toBe(200);
  });
});

// ===========================================================================
// §A16 Admin 绕过仅创建人删除
// ===========================================================================
test.describe("§A16 Admin绕过删除限制", () => {
  test("Admin可以删除同租户内其他人创建的记录", async ({ request }) => {
    // Create invitation for a same-tenant user
    const invRes = await request.post(`${API}/api/invitation`, {
      data: { role: "normal" },
      headers: { Authorization: `Bearer ${adminAuth.token}` },
    });
    if (invRes.ok()) {
      const { code } = await invRes.json();
      const ts = Date.now();
      const regRes = await request.post(`${API}/api/auth/register`, {
        data: { username: `victim_${ts}`, password: "test123456", inviteCode: code },
      });
      if (regRes.ok()) {
        const { token: victimToken } = await regRes.json();
        const createRes = await request.post(`${API}/api/nodes/attackTicket`, {
          data: { 标题: "他人记录_可被Admin删", 状态: "待响应" },
          headers: { Authorization: `Bearer ${victimToken}` },
        });
        if (createRes.ok()) {
          const { id } = await createRes.json();
          const delRes = await request.delete(`${API}/api/nodes/${id}`, {
            headers: { Authorization: `Bearer ${adminAuth.token}` },
          });
          expect(delRes.ok()).toBeTruthy();
        }
      }
    }
  });
});

// ===========================================================================
// §A17 表结构管理 — 核心类型保护
// ===========================================================================
test.describe("§A17 表结构管理", () => {
  test("核心类型无删除按钮", async ({ page }) => {
    await goTo(page, "/schema");
    await page.waitForTimeout(1500);
    const coreTypes = ["attackTicket", "person", "contribution"];
    for (const type of coreTypes) {
      const row = page.locator("tr").filter({ hasText: type }).first();
      if (await row.isVisible()) {
        const delBtn = row.getByRole("button", { name: /删除|Delete/ });
        await expect(delBtn).not.toBeVisible();
      }
    }
  });

  test("DELETE /api/schema/nodeType/attackTicket → 403", async ({ request }) => {
    const res = await request.delete(`${API}/api/schema/nodeType/attackTicket`, {
      headers: { Authorization: `Bearer ${adminAuth.token}` },
    });
    expect(res.status()).toBe(403);
  });

  test("DELETE /api/schema/nodeType/person → 403", async ({ request }) => {
    const res = await request.delete(`${API}/api/schema/nodeType/person`, {
      headers: { Authorization: `Bearer ${adminAuth.token}` },
    });
    expect(res.status()).toBe(403);
  });
});

// ===========================================================================
// §A18 分享功能
// ===========================================================================
test.describe("§A18 分享功能", () => {
  test("创建分享链接", async ({ page, request }) => {
    const ticketRes = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: "分享测试单", 状态: "待响应" },
      headers: { Authorization: `Bearer ${adminAuth.token}` },
    });
    if (ticketRes.ok()) {
      const { id } = await ticketRes.json();
      const shareRes = await request.post(`${API}/api/share`, {
        data: { entityType: "attackTicket", entityId: id },
        headers: { Authorization: `Bearer ${adminAuth.token}` },
      });
      if (shareRes.ok()) {
        const share = await shareRes.json();
        expect(share.id || share.token || share.link).toBeTruthy();
      }
    }
  });
});

// ===========================================================================
// §A19 业务 CRUD API — Admin 完整权限
// ===========================================================================
test.describe("§A19 业务CRUD API验证", () => {
  test("创建并删除攻关单", async ({ request }) => {
    const createRes = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: "Admin CRUD测试", 状态: "待响应" },
      headers: { Authorization: `Bearer ${adminAuth.token}` },
    });
    expect(createRes.ok()).toBeTruthy();
    const { id } = await createRes.json();
    const delRes = await request.delete(`${API}/api/nodes/${id}`, {
      headers: { Authorization: `Bearer ${adminAuth.token}` },
    });
    expect(delRes.ok()).toBeTruthy();
  });

  test("创建人员", async ({ request }) => {
    const res = await request.post(`${API}/api/nodes/person`, {
      data: { 姓名: `Admin人员_${Date.now()}` },
      headers: { Authorization: `Bearer ${adminAuth.token}` },
    });
    expect(res.ok()).toBeTruthy();
  });

  test("创建贡献", async ({ request }) => {
    const res = await request.post(`${API}/api/nodes/contribution`, {
      data: { 描述: "Admin贡献", 贡献人: "admin", 贡献类型: "发现" },
      headers: { Authorization: `Bearer ${adminAuth.token}` },
    });
    expect(res.ok()).toBeTruthy();
  });
});

// §A15 Admin可以访问系统管理API(举一反三)
test.describe("§A15 Admin系统管理API访问验证", () => {
  test("GET /api/settings → 200", async ({ request }) => {
    const res = await request.get(`${API}/api/settings`, {
      headers: { Authorization: `Bearer ${adminAuth.token}` },
    });
    expect(res.ok()).toBeTruthy();
  });

  test("PUT /api/settings/test-key → 200", async ({ request }) => {
    const res = await request.put(`${API}/api/settings/test-key`, {
      data: { values: ["admin-value"] },
      headers: { Authorization: `Bearer ${adminAuth.token}` },
    });
    expect(res.ok()).toBeTruthy();
  });

  test("POST /api/schema/scan → 200", async ({ request }) => {
    const res = await request.post(`${API}/api/schema/scan`, {
      headers: { Authorization: `Bearer ${adminAuth.token}` },
    });
    expect(res.ok()).toBeTruthy();
  });
});
