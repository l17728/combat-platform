import { test, expect } from "@playwright/test";
const API = "http://localhost:3001";

test("FE-6..FE-9 create / edit / delete record", async ({ page }) => {
  await page.goto("/attack");
  await page.getByLabel("new-row").click();                       // FE-6 create
  await page.getByLabel("draft-标题").fill("手工新建单");
  await page.getByLabel("draft-状态").fill("进行中");
  await page.getByLabel("create-row").click();
  await expect(page.getByText("手工新建单")).toBeVisible();

  await page.getByLabel(/edit-row-/).first().click();             // FE-7 edit
  await page.getByLabel("edit-标题").first().fill("改过的标题");
  await page.getByLabel(/save-/).first().click();
  await expect(page.getByText("改过的标题")).toBeVisible();
  await page.reload();                                            // FE-8 persists
  await expect(page.getByText("改过的标题")).toBeVisible();

  await page.getByLabel(/del-row-/).first().click();              // FE-9 delete
  await page.getByRole("button", { name: "OK" }).click();
  await expect(page.getByText("改过的标题")).toHaveCount(0);
});

test("FE-10..FE-12 add / rename / retire field", async ({ page, request }) => {
  await request.post(`${API}/api/nodes/attackTicket`, { data: { 标题: "字段测试单", 状态: "进行中" } });
  await page.goto("/attack");

  await page.getByLabel("add-field").click();                     // FE-10 add field
  await page.getByLabel("nf-name").fill("根因服务");
  await page.getByLabel("nf-label").fill("根因服务");
  await page.getByRole("button", { name: "添加" }).click();
  await expect(page.getByText("根因服务")).toBeVisible();

  await page.getByLabel("rename-标题").click();                   // FE-11 rename (Modal)
  await page.getByLabel("rename-input").fill("问题标题");
  await page.getByRole("button", { name: "确定" }).click();
  await expect(page.getByText("问题标题")).toBeVisible();
  await expect(page.getByText("字段测试单")).toBeVisible();        // data kept by id

  await page.getByLabel("retire-状态").click();                   // FE-12 retire
  await page.getByRole("button", { name: "OK" }).click();
  await expect(page.getByLabel("retire-状态")).toHaveCount(0);     // column gone
  await expect(page.getByText("字段测试单")).toBeVisible();        // data retained
});
