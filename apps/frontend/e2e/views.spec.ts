import { test, expect } from "@playwright/test";

// FE-VW1 §46 新作战表 view 渲染 + 首页卡片存在 + 泛型 CRUD 工作
test("FE-VW1 new combat-table views render + home card present + generic CRUD", async ({ page }) => {
  // home card present (aria-label is unique, avoids clashing with nav submenu link)
  await page.goto("/");
  await expect(page.getByLabel("home-card-/incidents")).toBeVisible();
  await expect(page.getByLabel("home-card-/experience")).toBeVisible();

  // incidents view renders the editable table
  await page.goto("/incidents");
  await expect(page.getByRole("button", { name: "new-row" })).toBeVisible();

  // experience view: generic create works for the new nodeType
  await page.goto("/experience");
  await page.getByRole("button", { name: "new-row" }).click();
  await page.getByLabel("draft-经验").fill("E2E经验沉淀");
  await page.getByRole("button", { name: "create-row" }).click();
  await expect(page.getByText("E2E经验沉淀").first()).toBeVisible();
});
