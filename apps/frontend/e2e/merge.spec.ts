import { test, expect } from "@playwright/test";

// FE-MG1 §40 MergePage: 选两人 → 预览 → Popconfirm 确认合并
test("FE-MG1 MergePage select + preview + confirm merge", async ({ page }) => {
  const persons = [
    { id: "p1", nodeType: "person", properties: { name: "张三", email: "zs@x.com" }, createdAt: "t", updatedAt: "t" },
    { id: "p2", nodeType: "person", properties: { name: "张三", employeeId: "E001" }, createdAt: "t", updatedAt: "t" },
  ];
  await page.route("**/api/nodes/person**", route => {
    if (route.request().method() === "GET")
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(persons) });
    return route.fallback();
  });
  await page.route("**/api/merge/preview**", route => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ from: persons[0], to: persons[1], unionedFields: ["email"], edgesToMigrate: 2 }),
  }));
  let merged = false;
  await page.route("**/api/merge/person", route => {
    merged = true;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(persons[1]) });
  });

  await page.goto("/merge");
  await expect(page.getByRole("heading", { name: "人员合并" })).toBeVisible();

  // pick from = p1 via keyboard
  await page.locator('input[aria-label="merge-from"]').focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  // pick to = p2
  await page.locator('input[aria-label="merge-to"]').focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");

  await page.getByRole("button", { name: "预览" }).click();
  const preview = page.getByLabel("merge-preview");
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("email");
  await expect(preview).toContainText("2");

  // The trigger carries aria-label="merge-confirm" (overrides its text as the
  // accessible name), so target by label, not by visible text.
  await page.getByLabel("merge-confirm").click();                      // open Popconfirm
  await page.getByRole("button", { name: "确认", exact: true }).click(); // confirm
  await expect.poll(() => merged).toBe(true);
});
