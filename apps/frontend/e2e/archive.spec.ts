import { test, expect } from "@playwright/test";
const API = "http://localhost:3001";

test("FE-AR1 发布包: nav → create row → 信息检索 hit", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "发布包", exact: true }).first().click();
  await expect(page).toHaveURL(/\/releases$/);
  await page.getByLabel("new-row").click();
  const ver = "vAR-" + Date.now();
  await page.getByLabel("draft-版本号").fill(ver);
  await page.getByLabel("draft-产品").fill("ModelArts-AR");
  await page.getByLabel("create-row").click();
  await expect(page.getByText(ver)).toBeVisible();
  await page.goto("/search");
  await page.getByLabel("query-input").fill(ver);
  await page.getByLabel("query-input").press("Enter");
  await expect(page.getByRole("link", { name: ver })).toBeVisible();
});

test("FE-AR2 权重文件: home card → create row + export button present", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("home-card-/weights").click();
  await expect(page).toHaveURL(/\/weights$/);
  await page.getByLabel("new-row").click();
  const nm = "wfAR-" + Date.now();
  await page.getByLabel("draft-名称").fill(nm);
  await page.getByLabel("draft-模型").fill("BERT-AR");
  await page.getByLabel("create-row").click();
  await expect(page.getByText(nm)).toBeVisible();
  await expect(page.getByLabel("export-excel")).toBeVisible();
});
