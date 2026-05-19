import { test, expect } from "@playwright/test";
const API = "http://localhost:3001";

test("FE-AN1 cross-granularity: shared anchor surfaces a separate 跨颗粒度 group", async ({ page, request }) => {
  const at = await (await request.post(`${API}/api/nodes/attackTicket`, { data: { 标题: "锚点攻关单", 状态: "进行中", 问题单号: "PBX-1" } })).json();
  const co = await (await request.post(`${API}/api/nodes/contribution`, { data: { 贡献人: "锚点贡献人", 关联问题单: "PBX-1" } })).json();
  await page.goto(`/related/attackTicket/${at.id}`);
  await expect(page.getByRole("heading", { name: "跨颗粒度（共享锚点）" })).toBeVisible();
  await expect(page.getByText("[问题单号:PBX-1]", { exact: false })).toBeVisible();
  // teardown: drop the two coarse nodes (+ their ANCHORED_TO edges) so this
  // fixture can't leak stale coAnchored peers into other specs in the run.
  await request.delete(`${API}/api/nodes/${at.id}`);
  await request.delete(`${API}/api/nodes/${co.id}`);
});

test("FE-AN2 锚点 editor persists via schema endpoint", async ({ page }) => {
  await page.goto("/attack");
  await page.getByLabel("anchor-标题").click();
  await page.getByLabel("anchor-input").fill("问题单号");
  await page.getByRole("button", { name: "确定" }).click();
  await expect.poll(async () => {
    const s = await (await page.request.get(`${API}/api/schema/attackTicket`)).json();
    return s.fields.find((f: any) => f.id === "标题")?.anchor ?? "";
  }).toBe("问题单号");
  await page.request.patch(`${API}/api/schema/attackTicket`, { data: { op: "setAnchor", id: "标题", anchor: "" } });
});
