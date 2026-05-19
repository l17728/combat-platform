import { test, expect } from "@playwright/test";
const API = "http://localhost:3001";

test("FE-X1 export button downloads an xlsx for the current nodeType", async ({ page, request }) => {
  await request.post(`${API}/api/nodes/attackTicket`, { data: { 标题: "导出单", 状态: "进行中" } });
  await page.goto("/attack");
  await expect(page.getByLabel("export-excel")).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByLabel("export-excel").click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^attackTicket-.*\.xlsx$/);
});
