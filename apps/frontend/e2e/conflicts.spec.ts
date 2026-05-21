import { test, expect } from "@playwright/test";

// 16-T3 FE-CF1: /conflicts page renders both Tabs (Conflicts / Overlaps),
// counts header, and the scan button triggers a POST.
test("FE-CF1 ConflictsPage Tabs + scan button + counts", async ({ page }) => {
  const rows = [
    {
      edgeType: "CONFLICTS_WITH",
      reason: "同负责人多并发：甲",
      source: { id: "a", nodeType: "attackTicket", properties: { 标题: "A" }, createdAt: "t", updatedAt: "t" },
      target: { id: "b", nodeType: "attackTicket", properties: { 标题: "B" }, createdAt: "t", updatedAt: "t" },
    },
    {
      edgeType: "OVERLAPS_WITH",
      reason: "同问题单：PB-1",
      source: { id: "c", nodeType: "attackTicket", properties: { 标题: "C" }, createdAt: "t", updatedAt: "t" },
      target: { id: "d", nodeType: "attackTicket", properties: { 标题: "D" }, createdAt: "t", updatedAt: "t" },
    },
  ];

  // GET /api/conflicts -> rows. POST /api/conflicts/scan -> counts.
  // Order matters: register the more-specific /scan route first so it wins
  // when the conflicts catch-all would otherwise swallow it.
  await page.route("**/api/conflicts/scan", route => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ conflicts: 1, overlaps: 1 }),
  }));
  await page.route("**/api/conflicts", route => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify(rows),
  }));

  await page.goto("/conflicts");

  // Two AntD Tabs by role.
  const conflictTab = page.getByRole("tab", { name: /冲突/ });
  const overlapTab = page.getByRole("tab", { name: /重叠/ });
  await expect(conflictTab).toBeVisible();
  await expect(overlapTab).toBeVisible();

  // Default tab (冲突) shows A / B titles. exact:true so single-letter names don't
  // substring-match nav links like "SLA上升" / "Oncall".
  await expect(page.getByRole("link", { name: "A", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "B", exact: true })).toBeVisible();

  // Counts header is visible (scope to aria-label to avoid post-scan "上次扫描" text).
  await expect(page.getByLabel("conflicts-counts")).toContainText(/冲突\s*1\s*·\s*重叠\s*1/);

  // Switch to 重叠 Tab.
  await overlapTab.click();
  await expect(page.getByRole("link", { name: "C", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "D", exact: true })).toBeVisible();

  // Click the rescan button — assert the post request is fired and counts still visible.
  const scanReq = page.waitForRequest(req => /\/api\/conflicts\/scan$/.test(req.url()) && req.method() === "POST");
  await page.getByRole("button", { name: /重新扫描/ }).click();
  await scanReq;
  await expect(page.getByLabel("conflicts-counts")).toContainText(/冲突\s*1\s*·\s*重叠\s*1/);
});

// 16-T3 FE-CF2: RelatedPage red conflicts panel renders when payload has conflicts.
test("FE-CF2 RelatedPage red conflicts panel renders", async ({ page }) => {
  await page.route("**/api/related/attackTicket/x**", route => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({
      outgoing: [], incoming: [],
      conflicts: [
        {
          edgeType: "CONFLICTS_WITH",
          reason: "同负责人多并发：甲",
          node: { id: "y", nodeType: "attackTicket", properties: { 标题: "Y单" }, createdAt: "t", updatedAt: "t" },
        },
      ],
    }),
  }));

  await page.goto("/related/attackTicket/x");

  const panel = page.getByLabel("conflicts-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("link", { name: "Y单" })).toBeVisible();
  await expect(panel.getByText(/同负责人多并发/)).toBeVisible();
  // The bracketed item-level label distinguishes 冲突 from 重叠 per-row;
  // use an exact bracketed match to avoid clashing with the panel heading "冲突 / 重叠".
  await expect(panel.getByText(/\[冲突\s·/)).toBeVisible();
});
