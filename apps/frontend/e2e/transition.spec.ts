import { test, expect } from "@playwright/test";
const API = "http://localhost:3001";

// FE-TR1 §41 AttackDetail 状态流转：选目标态 + 备注 → 流转 → 时间线出现新状态条目
test("FE-TR1 AttackDetail status transition appends a snapshotted progress entry", async ({ page, request }) => {
  const t = await (await request.post(`${API}/api/nodes/attackTicket`,
    { data: { 标题: "流转E2E单", 状态: "进行中" } })).json();
  await page.goto(`/attack/${t.id}`);

  // pick target status 已解决 via keyboard (AntD Select)
  await page.locator('input[aria-label="transition-status"]').focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowDown"); // 待响应,处理中,进行中,已解决
  await page.keyboard.press("Enter");
  await page.getByLabel("transition-note").fill("评审通过");
  await page.getByRole("button", { name: "流转" }).click();

  // timeline should now show a 已解决-snapshot entry containing the transition text
  await expect(page.getByText("进行中→已解决", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("评审通过", { exact: false }).first()).toBeVisible();
});
