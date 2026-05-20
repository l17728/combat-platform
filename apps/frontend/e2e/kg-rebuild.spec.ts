import { test, expect } from "@playwright/test";

// 17-T3 FE-KG1: ConflictsPage 「全量重建 KG」 button triggers POST /api/kg/rebuild
// and the result summary is rendered.
test("FE-KG1 ConflictsPage rebuild KG button shows rebuild summary", async ({ page }) => {
  // /api/conflicts (GET) — empty list keeps the page minimal.
  await page.route("**/api/conflicts/scan", route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ conflicts: 0, overlaps: 0 }),
  }));
  await page.route("**/api/kg/rebuild", route => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ refEdges: 7, anchorEdges: 5, conflicts: 1, overlaps: 2, durationMs: 42 }),
  }));
  await page.route("**/api/conflicts", route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify([]),
  }));

  await page.goto("/conflicts");

  const rebuildReq = page.waitForRequest(req => /\/api\/kg\/rebuild$/.test(req.url()) && req.method() === "POST");
  await page.getByRole("button", { name: /全量重建 KG/ }).click();
  await rebuildReq;

  const summary = page.getByLabel("rebuild-summary");
  await expect(summary).toBeVisible();
  await expect(summary).toContainText("REF 7");
  await expect(summary).toContainText("ANCHORED_TO 5");
  await expect(summary).toContainText("冲突 1");
  await expect(summary).toContainText("重叠 2");
  await expect(summary).toContainText("42ms");
});
