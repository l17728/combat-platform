import { test, expect } from "@playwright/test";
import { API, selectOption } from "./helpers";

// v2.3.4: 表结构管理新增「字段分组管理」面板。
//   - 选中 attackTicket → 详情卡里有「字段分组」侧栏 + 行内「分组」Select + 「↑/↓」按钮
//   - 通过 Select 把字段切到新分组,后端 updateField,接口返回的 schema 反映新 group
//   - 「新建分组」会写到第一个未分组字段(其它),作为占位
test.describe("SchemaWizard 字段分组管理 (v2.3.4)", () => {
  test("groups panel + per-field group select are rendered for attackTicket", async ({ page }) => {
    await page.goto("/schema");
    await page.waitForLoadState("domcontentloaded");

    // 点 attackTicket 行展开详情卡
    const row = page.locator(".ant-table-row").filter({ hasText: "attackTicket" });
    await row.first().click();
    await page.waitForTimeout(500);

    // 字段分组 panel 存在
    await expect(page.getByText("字段分组", { exact: false }).first()).toBeVisible({ timeout: 5000 });
    // 至少出现一个已知分组 Tag(基础信息 / 系统字段 之一)
    const baseTag = page.locator(".ant-tag").filter({ hasText: "基础信息" });
    await expect(baseTag.first()).toBeVisible();

    // 详情表格里有「分组」列 + 顺序列(↑/↓ 按钮)
    await expect(page.getByRole("columnheader", { name: "分组" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "顺序" })).toBeVisible();
  });

  test("changing field group via Select persists via updateField API", async ({ page, request }) => {
    // 先通过 API 加一个临时字段(归属「其它」分组),后续在 UI 切组验证
    const fname = "e2e分组切换_" + Date.now().toString(36);
    const add = await request.patch(`${API}/api/schema/attackTicket`, {
      headers: { "Content-Type": "application/json", "X-Role": "admin" },
      data: { op: "addField", field: { name: fname, type: "string", label: fname } },
    });
    expect(add.ok()).toBeTruthy();
    try {
      await page.goto("/schema");
      await page.waitForLoadState("domcontentloaded");
      const row = page.locator(".ant-table-row").filter({ hasText: "attackTicket" });
      await row.first().click();
      await page.waitForTimeout(500);

      // 找到刚加字段的那一行
      const fieldRow = page.locator(".ant-table-row").filter({ hasText: fname }).last();
      await expect(fieldRow).toBeVisible({ timeout: 5000 });

      // 该行的「分组」Select 是第一个 Select(类型 column 是 Tag,不是 Select)
      const groupSelect = fieldRow.locator(".ant-select").first();
      await selectOption(page, groupSelect, "基础信息");

      // 等成功 message
      await expect(page.getByText(/已移入分组/)).toBeVisible({ timeout: 3000 });

      // 通过 API 校验后端 schema 已更新
      const after = await request.get(`${API}/api/schema/attackTicket`);
      const json = await after.json();
      const f = (json.fields as any[]).find((x) => x.id === fname);
      expect(f).toBeTruthy();
      expect(f.group).toBe("基础信息");
    } finally {
      await request
        .patch(`${API}/api/schema/attackTicket`, {
          headers: { "Content-Type": "application/json", "X-Role": "admin" },
          data: { op: "retire", id: fname },
        })
        .catch(() => {});
    }
  });
});
