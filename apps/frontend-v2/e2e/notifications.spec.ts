import { test, expect } from "@playwright/test";
import { API } from "./helpers";

async function createNotification(opts: { userId?: string; kind?: string; title: string; link?: string }) {
  const r = await fetch(`${API}/api/notifications`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      userId: opts.userId ?? "admin",
      kind: opts.kind ?? "system",
      title: opts.title,
      body: "e2e body",
      link: opts.link,
    }),
  });
  if (!r.ok) {
    throw new Error(`create notification failed: ${r.status} ${await r.text()}`);
  }
  return r.json();
}

async function markAllAsRead() {
  const r = await fetch(`${API}/api/notifications/read-all`, { method: "POST" });
  if (!r.ok) throw new Error(`read-all failed: ${r.status}`);
  return r.json();
}

test.describe("通知中心 (inbox)", () => {
  test.beforeEach(async () => {
    // 清空 admin 收件箱避免互相干扰
    await markAllAsRead();
  });

  test("bell badge shows unread count and dropdown lists items", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // 初始铃铛存在
    const bell = page.locator('[data-testid="notification-bell"]');
    await expect(bell).toBeVisible();

    // 后台塞一条未读
    await createNotification({ title: "测试通知-A" });

    // 等轮询/SSE 刷新(组件 30s 轮询;主动重新打开就能触发 fetch)
    await page.waitForTimeout(800);
    await bell.click();

    const dropdown = page.locator('[data-testid="notification-dropdown"]');
    await expect(dropdown).toBeVisible();
    await expect(dropdown.getByText("测试通知-A")).toBeVisible();
  });

  test("clicking item marks it read", async ({ page }) => {
    await createNotification({ title: "测试通知-B" });

    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const bell = page.locator('[data-testid="notification-bell"]');
    await bell.click();

    const dropdown = page.locator('[data-testid="notification-dropdown"]');
    const item = dropdown.locator('[data-testid="notification-item"]', { hasText: "测试通知-B" }).first();
    await item.click();

    // 状态写回:重新打开铃铛,确认未读数减少 / 该条不在未读高亮中
    await page.waitForTimeout(500);
    const r = await fetch(`${API}/api/notifications?unread=true`);
    const data = await r.json();
    expect(Array.isArray(data.items)).toBe(true);
    expect(data.items.find((n: { title: string }) => n.title === "测试通知-B")).toBeUndefined();
  });

  test("notifications page lists all + mark-all works", async ({ page }) => {
    await createNotification({ title: "页面项-A", kind: "system" });
    await createNotification({ title: "页面项-B", kind: "bug_update" });

    await page.goto("/notifications");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByRole("heading", { name: "通知中心" })).toBeVisible();
    await expect(page.getByText("页面项-A")).toBeVisible();
    await expect(page.getByText("页面项-B")).toBeVisible();

    // 全部标已读
    await page.locator('[data-testid="notifications-mark-all"]').click();
    await expect(page.getByText(/已标记 \d+ 条为已读/)).toBeVisible();

    // 校验后端未读数为 0
    const r = await fetch(`${API}/api/notifications/unread-count`);
    const data = await r.json();
    expect(data.unreadCount).toBe(0);
  });
});
