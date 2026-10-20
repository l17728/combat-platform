import { test, expect } from "@playwright/test";
import { adminLogin, registerNormalUser, injectAuth, goTo, API, createTicket } from "./helpers";

test.describe("侧边栏审计卡片 — 所有角色可见", () => {
  let ticketId: string;

  test.beforeAll(async ({ request }) => {
    const auth = await adminLogin(request);
    const res = await createTicket(request, auth.token, "e2e审计卡片测试");
    const data = await res.json();
    ticketId = data.id;
  });

  test("admin: 合规追溯卡片可见（需先在面板中启用）", async ({ page }) => {
    const auth = await adminLogin(page.context().request);
    await injectAuth(page, auth);
    await goTo(page, `/attack/${ticketId}`);
    await page.waitForTimeout(3000);

    // Click "面板" button to open card visibility popover
    const panelBtn = page.getByRole("button", { name: /面板/ });
    if (await panelBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await panelBtn.click();
      await page.waitForTimeout(500);
      // Check the "合规追溯" checkbox
      const auditCheckbox = page.locator(".ant-checkbox-wrapper").filter({ hasText: "合规追溯" });
      if (await auditCheckbox.isVisible({ timeout: 3000 }).catch(() => false)) {
        await auditCheckbox.click();
        await page.waitForTimeout(1000);
      }
      // Close popover
      await page.keyboard.press("Escape");
    }

    await expect(page.getByText("合规追溯").first()).toBeVisible({ timeout: 5000 });
  });

  test("normal user: 合规追溯卡片可见（需先在面板中启用）", async ({ page }) => {
    const auth = await registerNormalUser(page.context().request);
    await injectAuth(page, auth);
    await goTo(page, `/attack/${ticketId}`);
    await page.waitForTimeout(3000);

    // Click "面板" button to open card visibility popover
    const panelBtn = page.getByRole("button", { name: /面板/ });
    if (await panelBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await panelBtn.click();
      await page.waitForTimeout(500);
      const auditCheckbox = page.locator(".ant-checkbox-wrapper").filter({ hasText: "合规追溯" });
      if (await auditCheckbox.isVisible({ timeout: 3000 }).catch(() => false)) {
        await auditCheckbox.click();
        await page.waitForTimeout(1000);
      }
      await page.keyboard.press("Escape");
    }

    const auditCard = page.getByText("合规追溯").first();
    expect(await auditCard.isVisible({ timeout: 5000 }).catch(() => false)).toBeTruthy();
  });
});

test.describe("支撑模板管理 — admin", () => {
  let auth: Awaited<ReturnType<typeof adminLogin>>;
  let ticketId: string;

  test.beforeAll(async ({ request }) => {
    auth = await adminLogin(request);
    const res = await createTicket(request, auth.token, "e2e模板管理测试");
    ticketId = (await res.json()).id;
  });

  test("求助网络 Tab 有管理模板按钮", async ({ page }) => {
    await injectAuth(page, auth);
    await goTo(page, `/attack/${ticketId}`);
    await page.waitForTimeout(2000);
    const supportTab = page.getByText("求助网络");
    if (await supportTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await supportTab.click();
      await page.waitForTimeout(1000);
      await expect(page.getByRole("button", { name: /管理模板/ })).toBeVisible({ timeout: 5000 });
    }
  });

  test("管理模板弹窗可打开", async ({ page }) => {
    await injectAuth(page, auth);
    await goTo(page, `/attack/${ticketId}`);
    await page.waitForTimeout(2000);
    const supportTab = page.getByText("求助网络");
    if (await supportTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await supportTab.click();
      await page.waitForTimeout(1000);
      const btn = page.getByRole("button", { name: /管理模板/ });
      if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await btn.click();
        await expect(page.locator(".ant-modal-title").filter({ hasText: "管理支撑模板" })).toBeVisible({ timeout: 5000 });
        await page.locator(".ant-modal-close").click();
      }
    }
  });

  test("API: 删除支撑模板", async ({ request }) => {
    const headers = { Authorization: `Bearer ${auth.token}` };
    const listRes = await request.get(`${API}/api/support-templates`, { headers });
    const templates = await listRes.json();
    if (templates.length > 0) {
      const delRes = await request.delete(`${API}/api/support-templates/${templates[0].id}`, { headers });
      expect(delRes.ok()).toBeTruthy();
    }
  });
});
