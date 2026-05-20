import { test, expect } from "@playwright/test";

test("FE-DP1 RelatedPage depth Select triggers expanded panel render", async ({ page }) => {
  // Mock /api/related to return a 2-hop expanded payload deterministically.
  await page.route("**/api/related/**", route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({
      outgoing: [], incoming: [], coAnchored: [],
      expanded: [
        { node: { id: "n2", nodeType: "person", properties: { name: "深度人A" }, createdAt: "t", updatedAt: "t" },
          depth: 2, viaEdgeType: "REF", viaField: "当前处理人", parentId: "n1" },
        { node: { id: "n3", nodeType: "attackTicket", properties: { 标题: "深度单B" }, createdAt: "t", updatedAt: "t" },
          depth: 2, viaEdgeType: "ANCHORED_TO", viaField: "关联问题单", parentId: "anchor1" },
      ],
    }),
  }));
  await page.goto("/related/attackTicket/n1");
  // Select depth=2 (triggers re-fetch but our mock returns the same expanded payload either way)
  await page.getByLabel("depth-select").click();
  await page.getByText("2", { exact: true }).click();
  const panel = page.getByLabel("expanded-panel");
  await expect(panel.getByRole("heading", { name: /扩展.*深度 2/ })).toBeVisible();
  await expect(panel.getByText("深度人A")).toBeVisible();
  await expect(panel.getByText("深度单B")).toBeVisible();
  await expect(panel.getByText("REF", { exact: false })).toBeVisible();
  await expect(panel.getByText("ANCHORED_TO", { exact: false })).toBeVisible();
});
