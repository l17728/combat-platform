import { test, expect } from "@playwright/test";
const API = "http://localhost:3001";

test("FE-H1..H3 homepage + nav integration", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "作战平台" })).toBeVisible();
  await page.getByRole("link", { name: "荣誉殿堂", exact: true }).first().click();
  await expect(page).toHaveURL(/\/honor$/);
  await page.getByRole("link", { name: "攻关作战台", exact: true }).first().click();
  await expect(page).toHaveURL(/\/attack$/);
  await expect(page.getByLabel("status-filter")).toBeVisible();
});

test("FE-H4..H6 record contribution -> weighted leaderboard -> personal profile backlink", async ({ page, request }) => {
  const t = await (await request.post(`${API}/api/nodes/attackTicket`, {
    data: { 标题: "荣誉攻关单", 攻关单号: "HK-1", 状态: "进行中" },
  })).json();

  // §50: setting 贡献等级 requires a privileged role; act as Leader.
  await page.addInitScript(() => localStorage.setItem("combat-role", "leader"));
  await page.goto("/contributions");
  await page.getByLabel("new-row").click();
  await page.getByLabel("draft-贡献人").fill("赵六");
  await page.getByLabel("draft-关联攻关单").fill("HK-1");
  await page.getByLabel("draft-贡献类型").fill("实施");
  await page.getByLabel("draft-贡献等级").fill("核心");
  await page.getByLabel("create-row").click();
  await expect(page.getByText("赵六")).toBeVisible();

  await page.goto("/honor");
  await expect(page.getByRole("link", { name: "赵六" })).toBeVisible();
  // GAP-21: row-scoped, data-independent score check (other specs add other
  // people's contributions to the shared leaderboard — bare getByText("8") was
  // fragile). 赵六 has exactly one 核心 contribution -> weighted score 8.
  await expect(page.getByRole("row").filter({ has: page.getByRole("link", { name: "赵六" }) }))
    .toContainText("8");

  await page.getByRole("link", { name: "赵六" }).click();
  await expect(page).toHaveURL(/\/honor\/%E8%B5%B5%E5%85%AD/);
  await expect(page.getByText("关联攻关单")).toBeVisible();
  await page.getByRole("link", { name: "关联攻关单" }).click();
  await expect(page).toHaveURL(new RegExp(`/attack/${t.id}`));
});
