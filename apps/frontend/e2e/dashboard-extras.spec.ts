import { test, expect } from "@playwright/test";

// FE-D2 §36 HomePage 态势区扩展: 冲突 / 今日动态 / 最近活跃 三块均渲染
test("FE-D2 HomePage shows dashboard-extras (conflicts / today / recent-activity)", async ({ page }) => {
  await page.route("**/api/dashboard", route => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({
      tickets: { total: 5, byStatus: { 进行中: 3, 已解决: 2 }, open: 3, resolved: 2 },
      contributions: { total: 4, topContributors: [{ 贡献人: "甲", count: 3 }] },
      proposalsPending: 1,
      conflicts: { count: 2, topReasons: ["同负责人多并发：甲", "同问题单：PB-1"] },
      today: { progressEntries: 7, ticketsTouched: 4 },
      recentActivity: [
        { ticketId: "t1", 标题: "断网攻关", 状态: "进行中", lastChangedAt: "2026-05-20T10:00:00Z" },
        { ticketId: "t2", 标题: "GPU 性能优化", 状态: "处理中", lastChangedAt: "2026-05-20T09:00:00Z" },
      ],
    }),
  }));

  await page.goto("/");

  const extras = page.getByLabel("dashboard-extras");
  await expect(extras).toBeVisible();
  await expect(extras).toContainText("2 对");
  await expect(extras).toContainText("同负责人多并发：甲");
  await expect(extras).toContainText("7 条进展");
  await expect(extras).toContainText("4 个攻关单");

  const recent = page.getByLabel("recent-activity");
  await expect(recent).toBeVisible();
  await expect(recent.getByRole("link", { name: "断网攻关" })).toBeVisible();
  await expect(recent.getByRole("link", { name: "GPU 性能优化" })).toBeVisible();
});
