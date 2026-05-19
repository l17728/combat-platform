import { test, expect } from "@playwright/test";
const API = "http://localhost:3001";

test("FE-A1 column-header 别名 editor sets aliases and persists", async ({ page }) => {
  await page.goto("/attack");
  await page.getByLabel("aliases-标题").click();
  const box = page.getByLabel("aliases-input");
  await box.fill("title\n问题标题\n事件标题");
  await page.getByRole("button", { name: "确定" }).click();
  await expect.poll(async () => {
    const s = await (await page.request.get(`${API}/api/schema/attackTicket`)).json();
    return s.fields.find((f: any) => f.id === "标题")?.aliases ?? [];
  }).toEqual(["title", "问题标题", "事件标题"]);
});
