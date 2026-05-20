import { test, expect } from "@playwright/test";
const API = "http://localhost:3001";

test("FE-IU1 ImportPage shows 新增/已更新 message (route-mocked, deterministic)", async ({ page }) => {
  await page.route("**/api/import**", route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ created: 3, updated: 2 }),
  }));
  await page.goto("/import");
  await expect(page.getByText("导入数据")).toBeVisible();
  // AntD Select sets aria-label on both wrapper and combobox input → use role
  await expect(page.getByRole("combobox", { name: "import-type" })).toBeVisible();
  await page.setInputFiles("input[type=file]", {
    name: "x.xlsx", mimeType: "application/octet-stream", buffer: Buffer.from("x"),
  });
  await expect(page.getByText("导入新增 3 · 已更新 2", { exact: false })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("导入完成");
});
