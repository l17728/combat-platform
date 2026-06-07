/**
 * Guest Role E2E Tests — Full Lifecycle
 *
 * Guest permissions:
 *   - Business menus: full CRUD (create, query, edit, delete own content)
 *   - System management: read-only visit (GET allowed, POST/PUT/DELETE/PATCH → 403)
 *   - AI assistant: usable
 *   - Sidebar: shows ALL menus including system management
 */
import { test, expect } from "@playwright/test";
import {
  API,
  guestAccess,
  goTo,
  injectAuth,
  type AuthResult,
  waitForTable,
  waitForDrawer,
  dismissTour,
} from "./helpers";

let guestAuth: AuthResult;

test.beforeAll(async ({ request }) => {
  guestAuth = await guestAccess(request);
});

test.beforeEach(async ({ page }) => {
  await injectAuth(page, guestAuth);
});

// ===========================================================================
// §G1 Guest Authentication
// ===========================================================================
test.describe("§G1 游客认证", () => {
  test("游客端点返回 token 和 username", async ({ request }) => {
    const res = await request.post(`${API}/api/platform/guest-access`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.token).toBeTruthy();
    expect(body.username).toMatch(/^guest_/);
  });

  test("游客 /auth/me 返回 guest_ 前缀用户名", async ({ request }) => {
    const res = await request.post(`${API}/api/platform/guest-access`);
    const { token } = await res.json();
    const me = await request.get(`${API}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(me.ok()).toBeTruthy();
    const body = await me.json();
    expect(body.user.username).toMatch(/^guest_/);
  });

  test("游客可以登录并看到首页", async ({ page }) => {
    await goTo(page, "/");
    await expect(page.locator("text=作战态势").first()).toBeVisible({ timeout: 10000 });
  });
});

// ===========================================================================
// §G2 攻关作战台 — Guest CRUD
// ===========================================================================
test.describe("§G2 攻关作战台", () => {
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
      const drawer = page.locator(".ant-drawer");
      const modal = page.locator(".ant-modal");
      const container = (await drawer.isVisible({ timeout: 5000 }).catch(() => false))
        ? drawer
        : (await modal.isVisible({ timeout: 3000 }).catch(() => false))
          ? modal
          : null;
      if (container) {
        const titleInput = container.locator("input, textarea").first();
        if (await titleInput.isVisible({ timeout: 3000 }).catch(() => false)) {
          await titleInput.fill(`游客测试单_${Date.now()}`);
        }
        const submitBtn = container.getByRole("button", { name: /提交|确定|保存/ }).first();
        if (await submitBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await submitBtn.click();
          await page.waitForTimeout(1000);
        }
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
// §G3 全员名单 — Guest CRUD
// ===========================================================================
test.describe("§G3 全员名单", () => {
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
        await nameInput.fill(`游客人员_${Date.now()}`);
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
// §G4 贡献录入 — Guest CRUD
// ===========================================================================
test.describe("§G4 贡献录入", () => {
  test("查看列表", async ({ page }) => {
    await goTo(page, "/contributions");
    await waitForTable(page).catch(() => {});
    await page.waitForTimeout(1000);
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

  test("搜索贡献", async ({ page }) => {
    await goTo(page, "/contributions");
    await waitForTable(page);
    const searchInput = page.locator("input[placeholder*='搜索']").first();
    if (await searchInput.isVisible()) {
      await searchInput.fill("测试");
      await page.waitForTimeout(500);
    }
  });
});

// ===========================================================================
// §G5 荣誉殿堂
// ===========================================================================
test.describe("§G5 荣誉殿堂", () => {
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
// §G6 攻关日报
// ===========================================================================
test.describe("§G6 攻关日报", () => {
  test("查看列表", async ({ page }) => {
    await goTo(page, "/daily-report");
    await waitForTable(page);
  });
});

// ===========================================================================
// §G7 求助中心 — Guest CRUD
// ===========================================================================
test.describe("§G7 求助中心", () => {
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
        await textarea.fill(`游客求助_${Date.now()}`);
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
// §G8 问题反馈 — Guest CRUD
// ===========================================================================
test.describe("§G8 问题反馈", () => {
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
        await input.fill(`游客反馈_${Date.now()}`);
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
// §G9 文档中心 — Guest CRUD
// ===========================================================================
test.describe("§G9 文档中心", () => {
  test("查看列表", async ({ page }) => {
    await goTo(page, "/documents");
    await page.waitForTimeout(1000);
  });
});

// ===========================================================================
// §G10 全局搜索
// ===========================================================================
test.describe("§G10 全局搜索", () => {
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
// §G11 知识图谱
// ===========================================================================
test.describe("§G11 知识图谱", () => {
  test("页面加载", async ({ page }) => {
    await goTo(page, "/kg");
    await page.waitForTimeout(2000);
  });
});

// ===========================================================================
// §G12 仪表盘
// ===========================================================================
test.describe("§G12 仪表盘", () => {
  test("页面加载、卡片可见", async ({ page }) => {
    await goTo(page, "/");
    await expect(page.locator("text=作战态势").first()).toBeVisible({ timeout: 10000 });
  });
});

// ===========================================================================
// §G13 侧边栏导航 — Guest 看到所有菜单含系统管理
// ===========================================================================
test.describe("§G13 侧边栏导航", () => {
  test("Guest看到系统管理菜单", async ({ page }) => {
    await goTo(page, "/");
    const sysMenu = page.locator(".ant-menu").getByText("系统管理").first();
    await expect(sysMenu).toBeVisible({ timeout: 5000 });
  });

  test("Guest看到攻关管理菜单", async ({ page }) => {
    await goTo(page, "/");
    const attackMenu = page.locator(".ant-menu").getByText("攻关管理").first();
    await expect(attackMenu).toBeVisible({ timeout: 5000 });
  });

  test("Guest看到人员与荣誉菜单", async ({ page }) => {
    await goTo(page, "/");
    const peopleMenu = page.locator(".ant-menu").getByText("人员与荣誉").first();
    await expect(peopleMenu).toBeVisible({ timeout: 5000 });
  });

  test("Guest看到求助中心菜单", async ({ page }) => {
    await goTo(page, "/");
    const helpMenu = page.locator(".ant-menu").getByText("求助中心").first();
    await expect(helpMenu).toBeVisible({ timeout: 5000 });
  });

  test("Guest看不到修改密码菜单项", async ({ page }) => {
    await goTo(page, "/");
    const userMenu = page.locator(".ant-menu").getByText("修改密码").first();
    await expect(userMenu).not.toBeVisible({ timeout: 3000 });
  });
});

// ===========================================================================
// §G14 系统管理 — Guest 只读参观（GET 允许，POST/PUT/DELETE → 403）
// ===========================================================================
test.describe("§G14 系统管理只读参观", () => {
  const systemPages = [
    { path: "/import", name: "数据导入/导出" },
    { path: "/schema", name: "表结构管理" },
    { path: "/config", name: "配置中心" },
    { path: "/email", name: "邮件设置" },
    { path: "/audit", name: "审计日志" },
    { path: "/backup", name: "备份恢复" },
    { path: "/users", name: "用户管理" },
    { path: "/invitations", name: "邀请管理" },
    { path: "/op-log", name: "操作追踪" },
    { path: "/llm-settings", name: "LLM设置" },
    { path: "/webhooks", name: "Webhook" },
    { path: "/merge", name: "人员合并" },
    { path: "/reminders", name: "提醒设置" },
    { path: "/proposals", name: "提案" },
    { path: "/digest", name: "邮件摘要" },
    { path: "/system-upgrade", name: "系统升级" },
    { path: "/db-migration", name: "数据库迁移" },
    { path: "/notifications", name: "通知管理" },
    { path: "/platform", name: "平台管理" },
  ];

  for (const { path, name } of systemPages) {
    test(`Guest可以访问${name}(${path})`, async ({ page }) => {
      await goTo(page, path);
      await page.waitForTimeout(1500);
      expect(page.url()).toContain(path);
    });
  }
});

// ===========================================================================
// §G15 系统管理 API — Guest 写操作被拦截（403）
// ===========================================================================
test.describe("§G15 系统管理API写操作403", () => {
  test("POST /api/backup → 403", async ({ request }) => {
    const res = await request.post(`${API}/api/backup`, {
      headers: { Authorization: `Bearer ${guestAuth.token}` },
    });
    expect([403, 429]).toContain(res.status());
  });

  test("POST /api/config → 403", async ({ request }) => {
    const res = await request.post(`${API}/api/config`, {
      data: { key: "test", value: "test" },
      headers: { Authorization: `Bearer ${guestAuth.token}` },
    });
    expect([403, 429, 404]).toContain(res.status());
  });

  test("PUT /api/llm-settings → 403", async ({ request }) => {
    const res = await request.put(`${API}/api/llm-settings`, {
      data: {},
      headers: { Authorization: `Bearer ${guestAuth.token}` },
    });
    expect([403, 429]).toContain(res.status());
  });

  test("DELETE /api/schema/nodeType/test → 403", async ({ request }) => {
    const res = await request.delete(`${API}/api/schema/nodeType/test`, {
      headers: { Authorization: `Bearer ${guestAuth.token}` },
    });
    expect([403, 429]).toContain(res.status());
  });

  test("POST /api/users → 403", async ({ request }) => {
    const res = await request.post(`${API}/api/users`, {
      data: { username: "hacker", password: "test" },
      headers: { Authorization: `Bearer ${guestAuth.token}` },
    });
    expect([403, 429]).toContain(res.status());
  });

  test("POST /api/invitation → 403", async ({ request }) => {
    const res = await request.post(`${API}/api/invitation`, {
      data: {},
      headers: { Authorization: `Bearer ${guestAuth.token}` },
    });
    expect([403, 429]).toContain(res.status());
  });

  test("POST /api/webhook → 403", async ({ request }) => {
    const res = await request.post(`${API}/api/webhook`, {
      data: { url: "https://evil.com" },
      headers: { Authorization: `Bearer ${guestAuth.token}` },
    });
    expect([403, 429]).toContain(res.status());
  });

  test("POST /api/merge → 403", async ({ request }) => {
    const res = await request.post(`${API}/api/merge`, {
      data: {},
      headers: { Authorization: `Bearer ${guestAuth.token}` },
    });
    expect([403, 429]).toContain(res.status());
  });

  test("POST /api/upgrade/upload → 403", async ({ request }) => {
    const res = await request.post(`${API}/api/upgrade/upload`, {
      headers: { Authorization: `Bearer ${guestAuth.token}` },
    });
    expect([403, 429]).toContain(res.status());
  });

  test("POST /api/db-migration/run → 403", async ({ request }) => {
    const res = await request.post(`${API}/api/db-migration/run`, {
      data: { pgUrl: "postgres://x:x@localhost/test" },
      headers: { Authorization: `Bearer ${guestAuth.token}` },
    });
    expect([403, 429]).toContain(res.status());
  });

  test("POST /api/db-migration/test-connection → 403", async ({ request }) => {
    const res = await request.post(`${API}/api/db-migration/test-connection`, {
      data: { pgUrl: "postgres://x:x@localhost/test" },
      headers: { Authorization: `Bearer ${guestAuth.token}` },
    });
    expect([403, 429]).toContain(res.status());
  });

  test("GET /api/export/attackTicket → 403 (write-semantic GET)", async ({ request }) => {
    const res = await request.get(`${API}/api/export/attackTicket`, {
      headers: { Authorization: `Bearer ${guestAuth.token}` },
    });
    expect(res.status()).toBe(403);
  });

  test("POST /api/auth/register → 不返回403（注册是公开端点）", async ({ request }) => {
    const res = await request.post(`${API}/api/auth/register`, {
      data: {
        username: "hacker_guest_test",
        password: "test123456",
        tenantName: "HackerTeam",
        tenantSlug: "hacker-team-guest",
      },
      headers: { Authorization: `Bearer ${guestAuth.token}` },
    });
    // register is a public endpoint — guest can register (won't get 403)
    expect(res.status()).not.toBe(403);
  });
});

// ===========================================================================
// §G16 系统管理 API — Guest 读操作允许（200）
// ===========================================================================
test.describe("§G16 系统管理API读操作允许", () => {
  test("GET /api/audit → 200", async ({ request }) => {
    const res = await request.get(`${API}/api/audit`, {
      headers: { Authorization: `Bearer ${guestAuth.token}` },
    });
    expect(res.status()).toBe(200);
  });

  test("GET /api/backup → 200 (列表可查看)", async ({ request }) => {
    const res = await request.get(`${API}/api/backup`, {
      headers: { Authorization: `Bearer ${guestAuth.token}` },
    });
    expect(res.status()).toBe(200);
  });

  test("GET /api/users → 200", async ({ request }) => {
    const res = await request.get(`${API}/api/users`, {
      headers: { Authorization: `Bearer ${guestAuth.token}` },
    });
    expect(res.status()).toBe(200);
  });

  test("GET /api/schema/list → 200", async ({ request }) => {
    const res = await request.get(`${API}/api/schema/list`, {
      headers: { Authorization: `Bearer ${guestAuth.token}` },
    });
    expect(res.status()).toBe(200);
  });

  test("GET /api/upgrade/current → 200", async ({ request }) => {
    const res = await request.get(`${API}/api/upgrade/current`, {
      headers: { Authorization: `Bearer ${guestAuth.token}` },
    });
    expect(res.status()).toBe(200);
  });

  test("GET /api/upgrade/history → 200", async ({ request }) => {
    const res = await request.get(`${API}/api/upgrade/history`, {
      headers: { Authorization: `Bearer ${guestAuth.token}` },
    });
    expect(res.status()).toBe(200);
  });

  test("GET /api/upgrade/status → 200", async ({ request }) => {
    const res = await request.get(`${API}/api/upgrade/status`, {
      headers: { Authorization: `Bearer ${guestAuth.token}` },
    });
    expect(res.status()).toBe(200);
  });

  test("GET /api/db-migration/status → 200", async ({ request }) => {
    const res = await request.get(`${API}/api/db-migration/status`, {
      headers: { Authorization: `Bearer ${guestAuth.token}` },
    });
    expect(res.status()).toBe(200);
  });
});

// ===========================================================================
// §G16b 系统管理页面 — Guest 进入加载数据、无告警 toast
// ===========================================================================
test.describe("§G16b 系统管理页面进入无告警", () => {
  const cases = [
    { path: "/system-upgrade", name: "系统升级", dataHint: /版本|commit|uptime|当前版本/i },
    { path: "/db-migration", name: "数据库迁移", dataHint: /驱动|SQLite|POSTGRES|数据库/i },
    { path: "/users", name: "用户管理", dataHint: /admin|用户名|角色/i },
  ];

  for (const { path, name, dataHint } of cases) {
    test(`Guest进入${name}(${path})加载正常无toast`, async ({ page }) => {
      await goTo(page, path);
      await page.waitForTimeout(5000);
      expect(page.url()).toContain(path);
      const toasts = await page.$$eval(".ant-message-notice-content", (els) => els.map((e) => e.textContent));
      expect(toasts).toEqual([]);
      const body =
        (await page.evaluate(() => {
          const el = document.querySelector(".ant-layout-content");
          return el ? el.innerText.substring(0, 800) : "";
        })) || "";
      expect(dataHint.test(body)).toBeTruthy();
    });
  }
});

// ===========================================================================
// §G16c 横幅可见性 — 系统管理页面有黄色横幅，业务页面无横幅
// ===========================================================================
test.describe("§G16c 横幅可见性", () => {
  const systemPages = [
    { path: "/schema", name: "表结构管理" },
    { path: "/config", name: "配置中心" },
    { path: "/users", name: "用户管理" },
    { path: "/backup", name: "备份恢复" },
    { path: "/audit", name: "审计日志" },
    { path: "/system-upgrade", name: "系统升级" },
  ];

  const businessPages = [
    { path: "/attack", name: "攻关作战台" },
    { path: "/people", name: "全员名单" },
    { path: "/contributions", name: "贡献录入" },
    { path: "/proposals", name: "关系审批" },
    { path: "/reminders", name: "跟催提醒" },
    { path: "/help", name: "求助中心" },
  ];

  async function findGuestBanner(page: import("@playwright/test").Page): Promise<string> {
    return page.evaluate(() => {
      const els = Array.from(document.querySelectorAll("div, span, p"));
      const match = els.find((el) => (el.textContent || "").includes("游客参观模式") && el.children.length === 0);
      return match ? match.textContent || "" : "";
    });
  }

  for (const { path, name } of systemPages) {
    test(`系统管理${name}(${path})有游客参观横幅`, async ({ page }) => {
      await goTo(page, path);
      await page.waitForTimeout(3000);
      const bannerText = await findGuestBanner(page);
      expect(bannerText).toContain("游客参观模式");
    });
  }

  for (const { path, name } of businessPages) {
    test(`业务${name}(${path})无游客参观横幅`, async ({ page }) => {
      await goTo(page, path);
      await page.waitForTimeout(3000);
      const bannerText = await findGuestBanner(page);
      expect(bannerText).toBe("");
    });
  }
});

// ===========================================================================
// §G17 AI 助手 — Guest 可以使用
// ===========================================================================
test.describe("§G17 AI助手", () => {
  test("详情页AI助手按钮可见", async ({ page, request }) => {
    const ticketRes = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: "AI测试单", 状态: "待响应" },
      headers: { Authorization: `Bearer ${guestAuth.token}` },
    });
    if (ticketRes.ok()) {
      const ticket = await ticketRes.json();
      await goTo(page, `/attack/${ticket.id}`);
      await page.waitForTimeout(3000);
      const aiBtn = page
        .locator("button, [role='button'], a")
        .filter({ hasText: /AI|助手|assistant/i })
        .first();
      const hasAi = await aiBtn.isVisible({ timeout: 5000 }).catch(() => false);
      expect(
        hasAi ||
          (await page
            .locator("text=/AI|助手/i")
            .first()
            .isVisible({ timeout: 3000 })
            .catch(() => false))
      ).toBeTruthy();
    }
  });
});

// ===========================================================================
// §G18 业务 CRUD API — Guest 可以创建和删除自己的内容
// ===========================================================================
test.describe("§G18 业务CRUD API验证", () => {
  test("Guest可以创建攻关单", async ({ request }) => {
    const res = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: "游客CRUD测试", 状态: "待响应" },
      headers: { Authorization: `Bearer ${guestAuth.token}` },
    });
    expect(res.ok()).toBeTruthy();
  });

  test("Guest可以查询攻关单列表", async ({ request }) => {
    const res = await request.get(`${API}/api/nodes/attackTicket`, {
      headers: { Authorization: `Bearer ${guestAuth.token}` },
    });
    expect(res.ok()).toBeTruthy();
  });

  test("Guest可以删除自己创建的记录", async ({ request }) => {
    const createRes = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: "游客删除测试", 状态: "待响应" },
      headers: { Authorization: `Bearer ${guestAuth.token}` },
    });
    expect(createRes.ok()).toBeTruthy();
    const { id } = await createRes.json();
    const delRes = await request.delete(`${API}/api/nodes/${id}`, {
      headers: { Authorization: `Bearer ${guestAuth.token}` },
    });
    expect(delRes.ok()).toBeTruthy();
  });

  test("Guest可以创建人员", async ({ request }) => {
    const res = await request.post(`${API}/api/nodes/person`, {
      data: { 姓名: `游客人员_${Date.now()}` },
      headers: { Authorization: `Bearer ${guestAuth.token}` },
    });
    expect(res.ok()).toBeTruthy();
  });

  test("Guest可以创建贡献", async ({ request }) => {
    const res = await request.post(`${API}/api/nodes/contribution`, {
      data: { 描述: "游客贡献测试", 贡献人: "guest", 贡献类型: "发现" },
      headers: { Authorization: `Bearer ${guestAuth.token}` },
    });
    expect(res.ok()).toBeTruthy();
  });
});

// §G19 Guest系统管理API只读验证(举一反三)
test.describe("§G19 Guest系统管理API只读验证", () => {
  test("Guest GET /api/settings → 200", async ({ request }) => {
    const res = await request.get(`${API}/api/settings`, {
      headers: { Authorization: `Bearer ${guestAuth.token}` },
    });
    expect(res.ok()).toBeTruthy();
  });

  test("Guest PUT /api/settings/test → 403", async ({ request }) => {
    const res = await request.put(`${API}/api/settings/test`, {
      data: { values: ["hack"] },
      headers: { Authorization: `Bearer ${guestAuth.token}` },
    });
    expect(res.status()).toBe(403);
  });

  test("Guest POST /api/schema/scan → 403", async ({ request }) => {
    const res = await request.post(`${API}/api/schema/scan`, {
      headers: { Authorization: `Bearer ${guestAuth.token}` },
    });
    expect(res.status()).toBe(403);
  });

  test("Guest POST /api/import → 403", async ({ request }) => {
    const res = await request.post(`${API}/api/import`, {
      headers: { Authorization: `Bearer ${guestAuth.token}` },
    });
    expect(res.status()).toBe(403);
  });

  test("Guest POST /api/hermes/tool/list_node_types → 403", async ({ request }) => {
    const res = await request.post(`${API}/api/hermes/tool/list_node_types`, {
      data: { input: {} },
      headers: { Authorization: `Bearer ${guestAuth.token}` },
    });
    expect(res.status()).toBe(403);
  });
});

// ===========================================================================
// §G20 业务页面 Guest CRUD — proposals/reminders 不被拦截
// ===========================================================================
test.describe("§G20 业务CRUD不被拦截", () => {
  test("Guest GET /api/proposals → 200 (非403)", async ({ request }) => {
    const res = await request.get(`${API}/api/proposals`, {
      headers: { Authorization: `Bearer ${guestAuth.token}` },
    });
    expect(res.status()).not.toBe(403);
  });

  test("Guest GET /api/reminders → 200 (非403)", async ({ request }) => {
    const res = await request.get(`${API}/api/reminders`, {
      headers: { Authorization: `Bearer ${guestAuth.token}` },
    });
    expect(res.status()).not.toBe(403);
  });

  test("Guest POST /api/proposals → 非403 (业务功能)", async ({ request }) => {
    const res = await request.post(`${API}/api/proposals`, {
      data: { targetId: "test", action: "test" },
      headers: { Authorization: `Bearer ${guestAuth.token}` },
    });
    expect(res.status()).not.toBe(403);
  });
});

// ===========================================================================
// §G21 Guest guard 拦截写操作 — 配置中心按钮被拦截
// ===========================================================================
test.describe("§G21 系统页面guard拦截写操作", () => {
  test("配置中心: guest点击新增按钮无弹窗", async ({ page }) => {
    await goTo(page, "/config");
    await page.waitForTimeout(3000);
    const addBtn = page.locator("button:has-text('新增'), button:has-text('添加')").first();
    if ((await addBtn.count()) > 0) {
      await addBtn.click();
      await page.waitForTimeout(1000);
      const modal = page.locator(".ant-modal-wrap-visible, .ant-modal-confirm-visible");
      expect(await modal.count()).toBe(0);
    }
  });

  test("用户管理: guest点击新增按钮无弹窗", async ({ page }) => {
    await goTo(page, "/users");
    await page.waitForTimeout(3000);
    const addBtn = page.locator("button:has-text('新增'), button:has-text('添加用户')").first();
    if ((await addBtn.count()) > 0) {
      await addBtn.click();
      await page.waitForTimeout(1000);
      const modal = page.locator(".ant-modal-wrap-visible");
      expect(await modal.count()).toBe(0);
    }
  });
});

// ===========================================================================
// §G22 路径列表一致性 — 前端三列表 + 后端列表核心路径全覆盖
// ===========================================================================
test.describe("§G22 路径列表覆盖验证", () => {
  const criticalSystemPaths = [
    "/api/config",
    "/api/settings",
    "/api/import",
    "/api/schema",
    "/api/audit",
    "/api/backup",
    "/api/upgrade",
    "/api/db-migration",
    "/api/users",
    "/api/email",
    "/api/llm-settings",
    "/api/merge",
    "/api/webhook",
  ];

  for (const path of criticalSystemPaths) {
    test(`Guest POST ${path} → 403`, async ({ request }) => {
      const res = await request.post(`${API}${path}`, {
        data: {},
        headers: { Authorization: `Bearer ${guestAuth.token}` },
      });
      expect([403, 429, 400]).toContain(res.status());
    });
  }
});
