import { test, expect } from "@playwright/test";

const MOCK_DIAGRAM = {
  mermaid: `flowchart TD
  P1["P1 事件"] -->|"SLA 2h → 运维Leader"| 运维Leader["运维Leader"]
  P2["P2 事件"] -->|"SLA 8h → 运维Leader"| 运维Leader`,
  nodeCount: 3,
  edgeCount: 2,
};

// FE-RP1: 责任矩阵页面加载并渲染 Mermaid 图
test("FE-RP1 ResponsibilityPage 加载责任矩阵并显示节点/边计数", async ({ page }) => {
  await page.route("**/api/responsibility/diagram", r => r.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify(MOCK_DIAGRAM),
  }));

  await page.goto("/responsibility");
  await expect(page.getByRole("heading", { name: /责任矩阵/ })).toBeVisible();

  // node/edge counts should appear
  await expect(page.getByText(/节点.*3/)).toBeVisible({ timeout: 5000 });
  await expect(page.getByText(/边.*2/)).toBeVisible();
});

// FE-RP2: 重新生成按钮再次触发 API
test("FE-RP2 重新生成按钮重新获取责任矩阵", async ({ page }) => {
  let callCount = 0;
  await page.route("**/api/responsibility/diagram", r => {
    callCount++;
    return r.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify(MOCK_DIAGRAM),
    });
  });

  await page.goto("/responsibility");
  await expect(page.getByText(/节点.*3/)).toBeVisible({ timeout: 5000 });

  await page.getByRole("button", { name: "重新生成" }).click();
  await expect(page.getByText(/节点.*3/)).toBeVisible({ timeout: 3000 });
  expect(callCount).toBeGreaterThanOrEqual(2);
});
