import { test, expect } from "@playwright/test";
const API = "http://localhost:3001";

test("FE-R1 ref field creates a cross-view relation reachable from the relations page", async ({ page, request }) => {
  const t = await (await request.post(`${API}/api/nodes/attackTicket`, { data: { 标题: "关联攻关单", 状态: "进行中", 当前处理人: "王五" } })).json();
  await request.post(`${API}/api/nodes/contribution`, { data: { 贡献人: "王五", 贡献类型: "实施", 贡献等级: "核心" } });
  await page.goto(`/related/attackTicket/${t.id}`);
  await expect(page.getByText("关联全景", { exact: false })).toBeVisible();
  await expect(page.getByText("person", { exact: false })).toBeVisible();
  await page.getByRole("link", { name: "王五" }).first().click();
  await expect(page).toHaveURL(/\/related\/person\//);
  await expect(page.getByText("attackTicket", { exact: false })).toBeVisible();
  await expect(page.getByText("contribution", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "关联攻关单" })).toBeVisible();
});
