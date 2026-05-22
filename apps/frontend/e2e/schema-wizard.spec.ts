import { test, expect } from "@playwright/test";

const MOCK_SCHEMAS = [
  { nodeType: "attackTicket", label: "攻关单", fields: [
    { id: "标题", name: "标题", label: "标题", type: "string" },
    { id: "状态", name: "状态", label: "状态", type: "enum", enumValues: ["待响应", "处理中"] },
  ], identityKeys: [], derivedToKG: true },
  { nodeType: "person", label: "人员", fields: [
    { id: "name", name: "name", label: "姓名", type: "string", concept: "person" },
  ], identityKeys: [], derivedToKG: true },
];

const MOCK_SUGGESTIONS = [
  { nodeType: "attackTicket", fieldId: "状态", fieldName: "状态", label: "状态",
    type: "enum", concept: "status", anchor: undefined, matchReason: "名称匹配" },
];

function mockSchemaRoutes(page: import("@playwright/test").Page) {
  page.route("**/api/schema/list", r => r.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify(MOCK_SCHEMAS),
  }));
  page.route("**/api/schema/suggest**", r => r.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify(MOCK_SUGGESTIONS),
  }));
  page.route("**/api/schema/nodeType", async r => {
    if (r.request().method() === "POST") {
      const body = JSON.parse(r.request().postData() ?? "{}");
      return r.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({
        nodeType: body.nodeType, label: body.label, fields: body.fields, identityKeys: [], derivedToKG: false,
      }) });
    }
    return r.continue();
  });
}

// FE-SW1: SchemaWizardPage 加载并展示现有表列表
test("FE-SW1 SchemaWizardPage 显示现有 schema 列表，点击展开字段", async ({ page }) => {
  await mockSchemaRoutes(page);
  await page.goto("/schema-wizard");
  await expect(page.getByRole("heading", { name: /动态新增表|Schema 管理/ })).toBeVisible();

  // schema list shows existing tables
  await expect(page.getByRole("cell", { name: "攻关单" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "人员" })).toBeVisible();

  // click a row to show field detail
  await page.getByRole("cell", { name: "攻关单" }).click();
  await expect(page.getByText("字段详情")).toBeVisible();
  // field detail table column headers visible
  await expect(page.getByText("字段ID").first()).toBeVisible();
});

// FE-SW2: 创建新表并成功提交
test("FE-SW2 新建表流程：填写表名+字段→提交成功", async ({ page }) => {
  await mockSchemaRoutes(page);
  await page.goto("/schema-wizard");

  // fill nodeType
  await page.getByPlaceholder(/workOrder/).fill("testWorkOrder");
  // fill label
  await page.getByPlaceholder(/工单/).fill("工单管理");

  // fill first field
  const nameInputs = page.getByPlaceholder(/status/);
  await nameInputs.first().fill("title");
  const labelInputs = page.getByPlaceholder(/状态/);
  await labelInputs.first().fill("标题");

  await page.getByRole("button", { name: "创建数据表" }).click();
  await expect(page.getByText(/创建成功|testWorkOrder/)).toBeVisible({ timeout: 5000 });
});

// FE-SW3: ref 类型字段显示目标表选择器
test("FE-SW3 ref 字段类型显示引用目标表下拉", async ({ page }) => {
  await mockSchemaRoutes(page);
  await page.goto("/schema-wizard");

  // change first field type to ref
  const typeSelect = page.locator(".ant-select").filter({ hasText: /文本|string/ }).first();
  await typeSelect.click();
  await page.getByText("引用 ref").click();

  // ref target selector should appear
  await expect(page.getByText("引用目标表")).toBeVisible();
});

// FE-SW4: 字段建议弹窗
test("FE-SW4 查找现有字段弹窗显示匹配结果", async ({ page }) => {
  await mockSchemaRoutes(page);
  await page.goto("/schema-wizard");

  // fill field name first so suggest has something to search
  await page.getByPlaceholder(/status/).first().fill("状态");

  // click 查找现有字段
  await page.getByRole("button", { name: "查找现有字段" }).first().click();
  await expect(page.getByText("名称匹配")).toBeVisible({ timeout: 3000 });
  await expect(page.getByText("status")).toBeVisible();
});
