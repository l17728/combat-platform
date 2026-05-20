import { test, expect } from "@playwright/test";

// FE-AU1 §39 AuditPage 渲染过滤表单 + 表格；UPDATE 过滤触发新请求
test("FE-AU1 AuditPage filter form + table render + action filter triggers refresh", async ({ page }) => {
  let lastQuery = "";
  await page.route("**/api/audit**", route => {
    lastQuery = new URL(route.request().url()).search;
    const all = [
      { id: "a1", action: "CREATE", entityType: "node", entityId: "n1",
        changes: { 标题: "X" }, performedBy: "甲", performedAt: "2026-05-21T01:00:00Z" },
      { id: "a2", action: "UPDATE", entityType: "node", entityId: "n1",
        changes: { 状态: "已解决" }, performedBy: "甲", performedAt: "2026-05-21T02:00:00Z" },
      { id: "a3", action: "DELETE", entityType: "node", entityId: "n2",
        changes: {}, performedBy: "乙", performedAt: "2026-05-21T03:00:00Z" },
    ];
    const url = new URL(route.request().url());
    const action = url.searchParams.get("action");
    const filtered = action ? all.filter(e => e.action === action) : all;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(filtered) });
  });

  await page.goto("/audit");
  await expect(page.getByRole("heading", { name: "审计日志" })).toBeVisible();
  // Default 3 rows
  await expect(page.getByText("CREATE", { exact: true })).toBeVisible();
  await expect(page.getByText("UPDATE", { exact: true })).toBeVisible();
  await expect(page.getByText("DELETE", { exact: true })).toBeVisible();

  // Filter by action=UPDATE via keyboard (AntD Select)
  await page.locator('input[aria-label="audit-action"]').focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown"); // 全部, CREATE, UPDATE
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "查询" }).click();
  // Now request should carry action=UPDATE
  await expect.poll(() => lastQuery).toContain("action=UPDATE");
});
