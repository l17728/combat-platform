import { test, expect, type Page } from "@playwright/test";
import { API, waitForDrawer } from "./helpers";

// v2.7: 详情/抽屉全栈 schema 驱动。
// 这组测试针对 5 个 nodeType,一律走"加 schema 字段 → 跳页面 → 表单出现该字段"的回归路径。
//
// 注:helpRequest/bugReport/proposal/reminder 是 virtual schema —
//     /api/nodes 拒收,但 /api/schema/* 完全可用,前端拉来渲染表单。

interface DriverCase {
  /** 给该 schema 加一个 group=E2E自定义分组 的字段 */
  nodeType: string;
  /** 测试路径 */
  url: string;
  /** 用什么按钮文本打开创建抽屉(/正则匹配 antd 中文加空格) */
  openButton: RegExp | string;
  /** 是否要先建一条记录 / 或者直接看抽屉里有字段就够 */
  expectFieldInDrawerOnly?: boolean;
}

const groupName = "E2E自定义分组";

async function addSchemaField(request: any, nodeType: string, fieldName: string) {
  const r = await request.patch(`${API}/api/schema/${nodeType}`, {
    headers: { "Content-Type": "application/json", "X-Role": "admin" },
    data: {
      op: "addField",
      field: { name: fieldName, type: "string", label: fieldName, group: groupName, order: 1 },
    },
  });
  if (!r.ok()) {
    const body = await r.text();
    throw new Error(`addField for ${nodeType}/${fieldName} failed: ${r.status()} ${body}`);
  }
}

async function retireSchemaField(request: any, nodeType: string, fieldName: string) {
  await request
    .patch(`${API}/api/schema/${nodeType}`, {
      headers: { "Content-Type": "application/json", "X-Role": "admin" },
      data: { op: "retire", id: fieldName },
    })
    .catch(() => {});
}

async function expectFieldInOpenDrawer(page: Page, fieldName: string) {
  const drawer = page.locator(".ant-drawer:not(.ant-drawer-content-hidden)").last();
  await drawer.waitFor({ state: "visible" });
  const formItem = drawer.locator(".ant-form-item").filter({ hasText: fieldName });
  await expect(formItem.first()).toBeVisible({ timeout: 8000 });
}

test.describe("schema-driven detail/drawer (v2.7)", () => {
  test("person — 添加字段后 创建抽屉里出现新字段", async ({ page, request }) => {
    const fname = "e2e人员字段_" + Date.now().toString(36);
    await addSchemaField(request, "person", fname);
    try {
      await page.goto("/people");
      // antd 2-char 中文按钮中间会插空格
      const btn = page.getByRole("button", { name: /添\s?加/ }).first();
      await btn.waitFor({ state: "visible", timeout: 10000 });
      await btn.click();
      await waitForDrawer(page);
      await expectFieldInOpenDrawer(page, fname);
    } finally {
      await retireSchemaField(request, "person", fname);
    }
  });

  test("contribution — 添加字段后 录入抽屉里出现新字段", async ({ page, request }) => {
    const fname = "e2e贡献字段_" + Date.now().toString(36);
    await addSchemaField(request, "contribution", fname);
    try {
      await page.addInitScript(() => localStorage.setItem("combat-role", "leader"));
      await page.goto("/contributions");
      const btn = page.getByRole("button", { name: /录入个人贡献/ });
      await btn.waitFor({ state: "visible", timeout: 10000 });
      await btn.click();
      await waitForDrawer(page);
      await expectFieldInOpenDrawer(page, fname);
    } finally {
      await retireSchemaField(request, "contribution", fname);
    }
  });

  test("teamContribution — 添加字段后 团队抽屉里出现新字段", async ({ page, request }) => {
    const fname = "e2e团队字段_" + Date.now().toString(36);
    await addSchemaField(request, "teamContribution", fname);
    try {
      await page.goto("/contributions");
      const btn = page.getByRole("button", { name: /录入团队贡献/ });
      await btn.waitFor({ state: "visible", timeout: 10000 });
      await btn.click();
      await waitForDrawer(page);
      await expectFieldInOpenDrawer(page, fname);
    } finally {
      await retireSchemaField(request, "teamContribution", fname);
    }
  });

  test("helpRequest — 添加 virtual schema 字段后 发起求助抽屉里出现新字段", async ({ page, request }) => {
    const fname = "e2e求助字段_" + Date.now().toString(36);
    await addSchemaField(request, "helpRequest", fname);
    try {
      await page.goto("/help");
      const btn = page.getByRole("button", { name: /发起求助/ });
      await btn.waitFor({ state: "visible", timeout: 10000 });
      await btn.click();
      await waitForDrawer(page);
      await expectFieldInOpenDrawer(page, fname);
    } finally {
      await retireSchemaField(request, "helpRequest", fname);
    }
  });

  test("bugReport — 添加 virtual schema 字段后 提交问题抽屉里出现新字段", async ({ page, request }) => {
    const fname = "e2eBug字段_" + Date.now().toString(36);
    await addSchemaField(request, "bugReport", fname);
    try {
      await page.goto("/bug-report");
      const btn = page.getByRole("button", { name: /提交问题/ });
      await btn.waitFor({ state: "visible", timeout: 10000 });
      await btn.click();
      await waitForDrawer(page);
      await expectFieldInOpenDrawer(page, fname);
    } finally {
      await retireSchemaField(request, "bugReport", fname);
    }
  });

  // 持久化验证:对 person 加字段 → 填值 → 保存 → 数据已写入
  test("person — 新字段填值后通过创建持久化", async ({ page, request }) => {
    const fname = "e2e持久化_" + Date.now().toString(36);
    const value = "测试值_" + Date.now().toString(36);
    const personName = "测试人员_" + Date.now().toString(36);
    await addSchemaField(request, "person", fname);
    try {
      await page.goto("/people");
      const btn = page.getByRole("button", { name: /添\s?加/ }).first();
      await btn.waitFor({ state: "visible", timeout: 10000 });
      await btn.click();
      await waitForDrawer(page);

      const drawer = page.locator(".ant-drawer:not(.ant-drawer-content-hidden)").last();
      // 姓名
      await drawer.getByLabel("姓名").fill(personName);
      // 新字段
      const formItem = drawer.locator(".ant-form-item").filter({ hasText: fname });
      await formItem.locator("input").first().fill(value);
      // 提交(drawer extra 上的"添加"按钮)
      await drawer.getByRole("button", { name: /添\s?加/ }).click();
      // 等抽屉关闭即视为提交成功
      await expect(drawer).not.toBeVisible({ timeout: 8000 });

      // 通过 API 验证
      const list = await request.get(`${API}/api/nodes/person`);
      const persons = await list.json();
      const created = (persons as any[]).find((p) => p.properties["姓名"] === personName);
      expect(created).toBeTruthy();
      expect(created.properties[fname]).toBe(value);

      // 清理
      await request.delete(`${API}/api/nodes/${created.id}`).catch(() => {});
    } finally {
      await retireSchemaField(request, "person", fname);
    }
  });
});

// 虚拟 schema 安全:确认 /api/nodes/<virtual> 仍然拒绝
test.describe("virtual schema /api/nodes gate (v2.7)", () => {
  for (const nt of ["helpRequest", "bugReport", "proposal", "reminder"]) {
    test(`/api/nodes/${nt} POST returns 400`, async ({ request }) => {
      const r = await request.post(`${API}/api/nodes/${nt}`, { data: {} });
      expect(r.status()).toBe(400);
      const body = await r.json();
      expect(String(body.error || "")).toMatch(/虚拟|virtual/);
    });
  }
});
