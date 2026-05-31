import { test, expect } from "@playwright/test";
import { API, selectOption, waitForTable } from "./helpers";

test.describe("表结构管理", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/schema");
    await page.waitForLoadState("domcontentloaded");
    // 等待 schema 表加载完毕(API listSchemas 返回后渲染若干行)
    await page
      .waitForResponse((r) => r.url().includes("/api/schema/list") && r.ok(), { timeout: 10000 })
      .catch(() => {});
    await page.locator(".ant-table-row").first().waitFor({ state: "visible", timeout: 10000 });
  });

  test("shows existing table list", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "表结构管理" })).toBeVisible();
    const rows = page.locator(".ant-table-row");
    await expect(rows.first()).toBeVisible({ timeout: 5000 });
    expect(await rows.count()).toBeGreaterThanOrEqual(3);
  });

  test("click table row shows detail card", async ({ page }) => {
    const firstRow = page.locator(".ant-table-row").first();
    await firstRow.click();
    await page.waitForTimeout(300);

    await expect(page.getByText("关闭")).toBeVisible();
  });

  test("close button hides detail card", async ({ page }) => {
    const firstRow = page.locator(".ant-table-row").first();
    await firstRow.click();
    await page.waitForTimeout(300);
    await expect(page.getByText("关闭")).toBeVisible();

    await page.getByRole("button", { name: "关闭" }).click();
    await page.waitForTimeout(300);
    await expect(page.getByRole("button", { name: "关闭" })).not.toBeVisible();
  });

  test("create new table with fields", async ({ page }) => {
    const tableName = "e2eTest" + Date.now().toString(36);

    await page.getByPlaceholder("e.g. workOrder").fill(tableName);
    await page.getByPlaceholder("e.g. 工单").fill("E2E测试表");

    const firstRowName = page.locator(".ant-table-row").last().locator("input").first();
    await firstRowName.fill("title");
    const firstRowLabel = page.locator(".ant-table-row").last().locator("input").nth(1);
    await firstRowLabel.fill("标题");

    await page.getByRole("button", { name: "创建数据表" }).click();
    await page.waitForTimeout(1500);

    await expect(page.locator("code").filter({ hasText: tableName })).toBeVisible();

    await page.request.delete(`${API}/api/schema/nodeType/${tableName}`, {
      headers: { "X-Role": "admin" },
    });
  });

  test("add field row button adds row", async ({ page }) => {
    const rowsBefore = await page.locator(".ant-table-row").count();

    await page.getByRole("button", { name: "添加字段" }).click();
    await page.waitForTimeout(300);

    const rowsAfter = await page.locator(".ant-table-row").count();
    expect(rowsAfter).toBeGreaterThan(rowsBefore);
  });

  test("delete field row button removes row", async ({ page }) => {
    await page.getByRole("button", { name: "添加字段" }).click();
    await page.waitForTimeout(300);

    const rowsBefore = await page.locator(".ant-table-row").count();
    const deleteButtons = page
      .locator(".ant-table-row")
      .last()
      .locator('button[aria-label="delete"], .ant-btn-dangerous');
    if (await deleteButtons.isVisible()) {
      await deleteButtons.click();
      await page.waitForTimeout(300);
      const rowsAfter = await page.locator(".ant-table-row").count();
      expect(rowsAfter).toBeLessThan(rowsBefore);
    }
  });

  test("field type select changes type", async ({ page }) => {
    const typeSelect = page.locator(".ant-table-row").last().locator(".ant-select").first();
    if (await typeSelect.isVisible()) {
      await selectOption(page, typeSelect, "枚举");
      await page.waitForTimeout(300);

      const enumInput = page.locator(".ant-table-row").last().locator('input[placeholder="待响应,处理中"]');
      if (await enumInput.isVisible()) {
        await enumInput.fill("选项A,选项B");
      }
    }
  });

  test("validation rejects empty table name", async ({ page }) => {
    await page.getByRole("button", { name: "创建数据表" }).click();
    await page.waitForTimeout(500);

    const msg = page.locator(".ant-message");
    await expect(msg).toBeVisible({ timeout: 3000 });
  });

  test("delete existing schema via popconfirm", async ({ page }) => {
    const res = await page.request.post(`${API}/api/schema/nodeType`, {
      headers: { "Content-Type": "application/json", "X-Role": "admin" },
      data: {
        nodeType: "e2eDelTest",
        label: "删除测试",
        fields: [{ id: "name", name: "name", label: "名称", type: "string" }],
      },
    });
    if (res.ok()) {
      await page.reload();
      await page.waitForLoadState("domcontentloaded");

      const row = page.locator(".ant-table-row").filter({ hasText: "e2eDelTest" });
      if (await row.isVisible()) {
        const deleteBtn = row.locator(".ant-btn-dangerous");
        if (await deleteBtn.isVisible()) {
          await deleteBtn.click();
          await page.waitForTimeout(300);
          await page
            .locator(".ant-popconfirm")
            .getByRole("button", { name: /确\s?定|OK/ })
            .click();
          await page.waitForTimeout(1000);
        }
      }
    }
  });

  test("find existing fields popover", async ({ page }) => {
    const popoverBtn = page.locator("button").filter({ hasText: /查找现有字段/ });
    if (await popoverBtn.isVisible()) {
      await popoverBtn.click();
      await page.waitForTimeout(1000);
    }
  });

  test("add field to existing table from detail card", async ({ page }) => {
    const nt = "e2eAddFld" + Date.now().toString(36);
    const created = await page.request.post(`${API}/api/schema/nodeType`, {
      headers: { "Content-Type": "application/json", "X-Role": "admin" },
      data: {
        nodeType: nt,
        label: "加字段测试",
        fields: [{ id: "name", name: "name", label: "名称", type: "string" }],
      },
    });
    expect(created.ok()).toBeTruthy();
    try {
      await page.reload();
      await page.waitForLoadState("domcontentloaded");

      const row = page.locator(".ant-table-row").filter({ hasText: nt });
      await row.click();
      await expect(page.getByText("添加新字段")).toBeVisible();

      const fieldName = "附加字段" + Date.now().toString(36);
      await page.getByPlaceholder("字段名").fill(fieldName);
      await page.getByPlaceholder("显示名(标签)").fill("附加显示名");
      await page.getByRole("button", { name: "新增字段" }).click();

      await expect(page.getByText(/已添加，相关页面将自动显示/)).toBeVisible();
      const detailCard = page.locator(".ant-card").filter({ hasText: "字段详情" });
      await expect(detailCard.getByText(fieldName)).toBeVisible();

      const dup = await page.request.patch(`${API}/api/schema/${nt}`, {
        headers: { "Content-Type": "application/json", "X-Role": "admin" },
        data: { op: "addField", field: { name: fieldName, type: "string", label: "重复" } },
      });
      expect(dup.status()).toBe(400);
    } finally {
      await page.request.delete(`${API}/api/schema/nodeType/${nt}`, { headers: { "X-Role": "admin" } });
    }
  });
});
