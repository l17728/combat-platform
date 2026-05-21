import { test, expect } from "@playwright/test";

// FE-IM2 §42 ImportPage 预览(不写入)：dryRun 返回逐行计划渲染为表
test("FE-IM2 ImportPage preview renders per-row plan without importing", async ({ page }) => {
  await page.route("**/api/import?**dryRun=1**", route => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({
      nodeType: "attackTicket", willCreate: 1, willUpdate: 0, skipped: 1,
      rows: [
        { rowIndex: 0, action: "create", summary: "有效新单" },
        { rowIndex: 1, action: "skip", reason: "标题: 必填", summary: "(空)" },
      ],
    }),
  }));

  await page.goto("/import");
  // second file input is the preview upload
  await page.locator("input[type=file]").nth(1).setInputFiles("e2e/fixtures/sample.xlsx");

  const tbl = page.getByLabel("import-preview");
  await expect(tbl).toBeVisible();
  await expect(tbl.getByText("有效新单")).toBeVisible();
  await expect(tbl.getByText("新增", { exact: true })).toBeVisible();
  await expect(tbl.getByText("跳过", { exact: true })).toBeVisible();
  await expect(tbl.getByText("标题: 必填")).toBeVisible();
});
