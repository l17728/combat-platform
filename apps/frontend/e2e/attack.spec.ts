import { test, expect } from "@playwright/test";

const API = "http://localhost:3001";

test("FE-1..FE-4 list, filter, detail, append progress", async ({ page, request }) => {
  const t1 = await (await request.post(`${API}/api/nodes/attackTicket`,
    { data: { 标题: "E2E进行中单", 状态: "进行中" } })).json();
  await request.post(`${API}/api/nodes/attackTicket`, { data: { 标题: "E2E已解决单", 状态: "已解决" } });
  await request.post(`${API}/api/nodes/${t1.id}/progress`,
    { data: { content: "首次进展", statusSnapshot: "进行中", actor: "seed" } });

  await page.goto("/attack");                                   // FE-1
  await expect(page.getByText("E2E进行中单")).toBeVisible();
  await expect(page.getByText("E2E已解决单")).toBeVisible();

  await page.getByLabel("status-filter").fill("进行中");          // FE-2
  await page.getByLabel("status-filter").press("Enter");
  await expect(page.getByText("E2E已解决单")).toHaveCount(0);
  await expect(page.getByText("E2E进行中单")).toBeVisible();

  await page.getByRole("link", { name: "E2E进行中单" }).click(); // FE-3
  await expect(page.getByText("首次进展", { exact: false })).toBeVisible();

  await page.getByLabel("progress-input").fill("第二次进展");     // FE-4
  await page.getByRole("button", { name: "追加进展" }).click();
  await expect(page.getByText("#2", { exact: false })).toBeVisible();
  await expect(page.getByText("首次进展", { exact: false })).toBeVisible(); // traceable
});

test("FE-5 import xlsx then see rows", async ({ page }) => {
  await page.goto("/import");
  await page.setInputFiles("input[type=file]", "e2e/fixtures/sample.xlsx");
  await expect(page.getByText("导入完成")).toBeVisible();
  await page.goto("/attack");
  await expect(page.getByText("导入断连A")).toBeVisible();
});
