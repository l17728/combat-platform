import { test, expect } from "@playwright/test";
const API = "http://localhost:3001";

test("FE-RC1 find-helpers: AttackDetail shows ranked helper with reason, links to person", async ({ page, request }) => {
  const T = await (await request.post(`${API}/api/nodes/attackTicket`, { data: { 标题: "推荐主单RC", 状态: "进行中", 问题单号: "RC-1", 当前处理人: "处理甲RC" } })).json();
  await request.post(`${API}/api/nodes/attackTicket`, { data: { 标题: "推荐同域单RC", 状态: "进行中", 问题单号: "RC-1", 当前处理人: "能帮乙RC" } });
  await page.goto(`/attack/${T.id}`);
  const panel = page.getByLabel("find-helpers");
  await expect(panel.getByRole("heading", { name: "找帮手" })).toBeVisible();
  await expect(panel.getByText("RC-1", { exact: false })).toBeVisible();
  const link = panel.getByRole("link", { name: "能帮乙RC" });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/related\/person\//);
});

test("FE-RC2 no-evidence ticket → 暂无可推荐人选", async ({ page, request }) => {
  const T = await (await request.post(`${API}/api/nodes/attackTicket`, { data: { 标题: "孤立推荐单RC", 状态: "进行中" } })).json();
  await page.goto(`/attack/${T.id}`);
  await expect(page.getByLabel("find-helpers").getByRole("status")).toHaveText("暂无可推荐人选");
});
