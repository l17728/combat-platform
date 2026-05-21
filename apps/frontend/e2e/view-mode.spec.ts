import { test, expect } from "@playwright/test";
const API = "http://localhost:3001";

// FE-VM1 §47 EntityTable 表格↔卡片视图切换，同一数据一致
test("FE-VM1 EntityTable table↔card view toggle keeps data consistent", async ({ page, request }) => {
  await request.post(`${API}/api/nodes/attackTicket`, { data: { 标题: "视图切换单VM", 状态: "进行中" } });
  await page.goto("/attack");
  // table mode shows the row title
  await expect(page.getByText("视图切换单VM").first()).toBeVisible();
  // switch to card mode
  await page.getByText("卡片", { exact: true }).click();
  const cards = page.getByLabel("entity-card");
  await expect(cards.first()).toBeVisible();
  await expect(page.getByLabel("card-grid").getByText("视图切换单VM").first()).toBeVisible();
  // switch back to table — header field button still present
  await page.getByText("表格", { exact: true }).click();
  await expect(page.getByRole("button", { name: "add-field" })).toBeVisible();
});
