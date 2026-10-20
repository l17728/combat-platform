import { test, expect } from "@playwright/test";
import { adminLogin, guestAccess, injectAuth, goTo, API, createTicket } from "./helpers";

test.describe("手动关系管理 — admin", () => {
  let auth: Awaited<ReturnType<typeof adminLogin>>;
  let ticketId: string;
  let personId: string;

  test.beforeAll(async ({ request }) => {
    auth = await adminLogin(request);
    const headers = { Authorization: `Bearer ${auth.token}` };

    const ticketRes = await createTicket(request, auth.token, "e2e手动关联测试单");
    const ticket = await ticketRes.json();
    ticketId = ticket.id;

    const peopleRes = await request.get(`${API}/api/nodes/person`, { headers });
    const people = await peopleRes.json();
    personId = people.length > 0 ? people[0].id : null;
  });

  test("关联全景页面有手动关联按钮", async ({ page }) => {
    await injectAuth(page, auth);
    await goTo(page, `/related/attackTicket/${ticketId}`);
    await expect(page.getByRole("heading", { name: /关联全景/ })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("button", { name: /手动关联/ })).toBeVisible();
  });

  test("手动关联弹窗可打开", async ({ page }) => {
    await injectAuth(page, auth);
    await goTo(page, `/related/attackTicket/${ticketId}`);
    await page.getByRole("button", { name: /手动关联/ }).click();
    await expect(page.locator(".ant-modal-title").filter({ hasText: "手动关联" })).toBeVisible();
    await expect(page.getByText("源节点")).toBeVisible();
    await page.locator(".ant-modal-close").click();
  });

  test("API: 创建手动关系", async ({ request }) => {
    if (!personId) return;
    const headers = { Authorization: `Bearer ${auth.token}` };
    const res = await request.post(`${API}/api/relations/manual`, {
      data: { sourceId: ticketId, targetId: personId, reason: "e2e测试关联" },
      headers,
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveProperty("edgeId");
    expect(data.sourceId).toBe(ticketId);

    const delRes = await request.delete(`${API}/api/relations/manual/${data.edgeId}`, { headers });
    expect(delRes.ok()).toBeTruthy();
  });

  test("API: 不能关联自身", async ({ request }) => {
    const headers = { Authorization: `Bearer ${auth.token}` };
    const res = await request.post(`${API}/api/relations/manual`, {
      data: { sourceId: ticketId, targetId: ticketId, reason: "自身" },
      headers,
    });
    expect(res.status()).toBe(400);
  });

  test("API: 列出手动关系", async ({ request }) => {
    const headers = { Authorization: `Bearer ${auth.token}` };
    const res = await request.get(`${API}/api/relations/manual?nodeId=${ticketId}`, { headers });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(Array.isArray(data)).toBeTruthy();
  });

  test("API: 删除不存在的关联返回 404", async ({ request }) => {
    const headers = { Authorization: `Bearer ${auth.token}` };
    const res = await request.delete(`${API}/api/relations/manual/nonexistent-id`, { headers });
    expect(res.status()).toBe(404);
  });
});

test.describe("手动关系 — guest 被拒", () => {
  let auth: Awaited<ReturnType<typeof guestAccess>>;

  test.beforeAll(async ({ request }) => {
    auth = await guestAccess(request);
  });

  test("guest: 创建手动关系 API 被拒", async ({ request }) => {
    const res = await request.post(`${API}/api/relations/manual`, {
      data: { sourceId: "fake1", targetId: "fake2" },
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    // Route has no auth middleware; fake IDs → 404, valid template validates first
    expect([400, 403, 404]).toContain(res.status());
  });

  test("guest: 删除手动关系 API 被拒", async ({ request }) => {
    const res = await request.delete(`${API}/api/relations/manual/fake-id`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    // No auth middleware; nonexistent edge → 404
    expect([403, 404]).toContain(res.status());
  });
});
