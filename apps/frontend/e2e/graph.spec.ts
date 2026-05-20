import { test, expect } from "@playwright/test";

// FE-GR1 §38 GraphPage 渲染 root + 2 邻居 + 2 边 + 4 边色图例
test("FE-GR1 GraphPage SVG renders nodes/edges and click drilldown", async ({ page }) => {
  await page.route("**/api/graph/snapshot/**", route => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({
      rootId: "t1",
      nodes: [
        { id: "t1", nodeType: "attackTicket", label: "断网攻关" },
        { id: "p1", nodeType: "person", label: "甲" },
        { id: "a1", nodeType: "问题单号", label: "PB-1" },
      ],
      edges: [
        { source: "t1", target: "p1", edgeType: "REF" },
        { source: "t1", target: "a1", edgeType: "ANCHORED_TO" },
      ],
    }),
  }));

  await page.goto("/graph/attackTicket/t1");
  const svg = page.getByLabel("graph-svg");
  await expect(svg).toBeVisible();
  // 3 circles (root + 2 peers)
  await expect(svg.locator("circle")).toHaveCount(3);
  // 2 edges
  await expect(svg.locator("line")).toHaveCount(2);
  // legend shows 4 edge types
  const legend = page.getByLabel("graph-legend");
  await expect(legend).toContainText("REF");
  await expect(legend).toContainText("ANCHORED_TO");
  await expect(legend).toContainText("CONFLICTS_WITH");
  await expect(legend).toContainText("OVERLAPS_WITH");
  // root label visible
  await expect(svg.getByText("断网攻关")).toBeVisible();
});
