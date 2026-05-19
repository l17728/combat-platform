import { test, expect } from "@playwright/test";
const API = "http://localhost:3001";

test("FE-C1 concept editor persists + cross-view same-concept merge in RelatedPage", async ({ page, request }) => {
  await page.goto("/attack");
  await page.getByLabel("concept-标题").click();
  await page.getByLabel("concept-input").fill("标识符");
  await page.getByRole("button", { name: "确定" }).click();
  await expect.poll(async () => {
    const s = await (await page.request.get(`${API}/api/schema/attackTicket`)).json();
    return s.fields.find((f: any) => f.id === "标题")?.concept ?? "";
  }).toBe("标识符");

  await request.post(`${API}/api/nodes/attackTicket`, { data: { 标题: "概念攻关单", 状态: "进行中", 当前处理人: "概念人" } });
  await request.post(`${API}/api/nodes/contribution`, { data: { 贡献人: "概念人", 贡献类型: "设计" } });
  const list = await (await page.request.get(`${API}/api/nodes/attackTicket`)).json();
  const at = list.find((n: any) => n.properties["标题"] === "概念攻关单");
  await page.goto(`/related/attackTicket/${at.id}`);
  await page.getByRole("link", { name: "概念人" }).first().click();
  await expect(page).toHaveURL(/\/related\/person\//);
  await expect(page.getByRole("heading", { name: /负责人/ })).toBeVisible();
  await expect(page.getByText("概念攻关单", { exact: false })).toBeVisible();
  await expect(page.getByText("[当前处理人]", { exact: false })).toBeVisible();
  await expect(page.getByText("[贡献人]", { exact: false })).toBeVisible();

  // single-backend determinism: this spec edited a seed field's concept; clear it
  // so spec ordering can't leak 标题.concept into later specs.
  await request.patch(`${API}/api/schema/attackTicket`, { data: { op: "setConcept", id: "标题", concept: "" } });
});
