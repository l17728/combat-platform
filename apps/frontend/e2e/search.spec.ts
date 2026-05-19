import { test, expect } from "@playwright/test";
const API = "http://localhost:3001";

test("FE-S1 search: nav, query, result link navigates; empty/no-result states", async ({ page, request }) => {
  await request.post(`${API}/api/nodes/attackTicket`, { data: { 标题: "检索目标单SX", 状态: "进行中" } });
  await page.goto("/");
  await page.getByRole("link", { name: "信息检索", exact: true }).first().click();
  await expect(page).toHaveURL(/\/search$/);
  await page.getByLabel("query-input").fill("检索目标单SX");
  await page.getByLabel("query-input").press("Enter");
  const link = page.getByRole("link", { name: "检索目标单SX" });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/attack\//);
  await page.goto("/search");
  await page.getByLabel("query-input").fill("绝不存在的关键词ZZZ");
  await page.getByLabel("query-input").press("Enter");
  await expect(page.getByRole("status")).toHaveText("无匹配结果");
});
