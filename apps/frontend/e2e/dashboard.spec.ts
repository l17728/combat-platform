import { test, expect } from "@playwright/test";
const API = "http://localhost:3001";

test("FE-D1 homepage dashboard reflects data; module cards still present/usable", async ({ page, request }) => {
  await request.post(`${API}/api/nodes/attackTicket`, { data: { 标题: "大盘单D1", 状态: "进行中" } });
  await page.goto("/");
  const dash = page.getByLabel("dashboard");
  await expect(dash.getByText("攻关单总数")).toBeVisible();
  await expect(dash.getByText("进行中", { exact: false })).toBeVisible();
  await expect(dash.getByText("状态分布", { exact: false })).toBeVisible();
  await expect(page.getByLabel("home-card-/attack")).toBeVisible();
  await expect(page.getByLabel("home-card-/search")).toBeVisible();
  await page.getByRole("link", { name: "攻关作战台", exact: true }).first().click();
  await expect(page).toHaveURL(/\/attack$/);
});
