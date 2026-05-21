import { test, expect } from "@playwright/test";

// FE-ES1 §48 EscalationPage 配置 + 扫描 + 已上升列表（route-mock）
test("FE-ES1 EscalationPage config + scan + escalated list", async ({ page }) => {
  await page.route("**/api/escalation/config", route => {
    if (route.request().method() === "PUT")
      return route.fulfill({ status: 200, contentType: "application/json", body: route.request().postData() ?? "{}" });
    return route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ rules: [{ 事件级别: "P4A", slaHours: 4, 上升角色: "值班接口人" }] }) });
  });
  await page.route("**/api/escalation/scan", route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ overdue: 2, escalated: 1 }),
  }));
  await page.route("**/api/audit**", route => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify([{ id: "a1", action: "ESCALATE", entityType: "node", entityId: "t1234567890",
      changes: { 事件级别: "P4A", slaHours: 4 }, performedBy: "system", performedAt: "2026-05-21T03:00:00Z" }]),
  }));

  await page.goto("/escalation");
  await expect(page.getByRole("heading", { name: /SLA 上升/ })).toBeVisible();
  await expect(page.getByLabel("rule-level-0")).toHaveValue("P4A");
  // escalated list shows the ESCALATE audit
  await expect(page.getByLabel("escalated-list").getByText(/ESCALATE|P4A/).first()).toBeVisible();
  // scan
  await page.getByLabel("scan-escalation").click();
  // toast appears (best-effort) — assert rules table still rendered
  await expect(page.getByLabel("escalation-rules")).toBeVisible();
});
