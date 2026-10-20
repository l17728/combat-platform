import { test, expect } from "@playwright/test";
import { adminLogin, injectAuth, goTo, API } from "./helpers";

test.describe("UI 置顶 — admin", () => {
  let auth: Awaited<ReturnType<typeof adminLogin>>;

  test.beforeAll(async ({ request }) => {
    auth = await adminLogin(request);
  });

  test("API: 置顶 widget", async ({ request }) => {
    const headers = { Authorization: `Bearer ${auth.token}` };
    const res = await request.post(`${API}/api/ui-cache/pin`, {
      data: {
        label: "e2e测试置顶",
        question: "测试问题",
        intent: "test",
        uiSpec: { widget: "table", params: { columns: [], rows: [] }, cacheKey: "e2e-test" },
      },
      headers,
    });
    expect(res.ok()).toBeTruthy();
    const pin = await res.json();
    expect(pin.label).toBe("e2e测试置顶");
    expect(pin).toHaveProperty("id");

    const delRes = await request.delete(`${API}/api/ui-cache/pinned/${pin.id}`, { headers });
    expect(delRes.ok()).toBeTruthy();
  });

  test("API: 列出置顶 widgets", async ({ request }) => {
    const headers = { Authorization: `Bearer ${auth.token}` };
    const res = await request.get(`${API}/api/ui-cache/pinned`, { headers });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(Array.isArray(data)).toBeTruthy();
  });

  test("API: 重命名置顶 widget", async ({ request }) => {
    const headers = { Authorization: `Bearer ${auth.token}` };
    const createRes = await request.post(`${API}/api/ui-cache/pin`, {
      data: {
        label: "原名",
        uiSpec: { widget: "stats", params: {}, cacheKey: "e2e-rename-test" },
      },
      headers,
    });
    const pin = await createRes.json();

    const renameRes = await request.patch(`${API}/api/ui-cache/pinned/${pin.id}`, {
      data: { label: "新名" },
      headers,
    });
    expect(renameRes.ok()).toBeTruthy();
    const renamed = await renameRes.json();
    expect(renamed.label).toBe("新名");

    await request.delete(`${API}/api/ui-cache/pinned/${pin.id}`, { headers });
  });

  test("API: 取消置顶", async ({ request }) => {
    const headers = { Authorization: `Bearer ${auth.token}` };
    const createRes = await request.post(`${API}/api/ui-cache/pin`, {
      data: {
        label: "待删除",
        uiSpec: { widget: "card-grid", params: {}, cacheKey: "e2e-unpin-test" },
      },
      headers,
    });
    const pin = await createRes.json();

    const delRes = await request.delete(`${API}/api/ui-cache/pinned/${pin.id}`, { headers });
    expect(delRes.ok()).toBeTruthy();

    const listRes = await request.get(`${API}/api/ui-cache/pinned`, { headers });
    const list = await listRes.json();
    expect(list.find((p: any) => p.id === pin.id)).toBeFalsy();
  });

  test("Dashboard 首页加载无报错", async ({ page }) => {
    await injectAuth(page, auth);
    await goTo(page, "/attack");
    await page.waitForTimeout(2000);
    const has500 = await page.locator("text=500").isVisible({ timeout: 1000 }).catch(() => false);
    expect(has500).toBeFalsy();
  });
});
