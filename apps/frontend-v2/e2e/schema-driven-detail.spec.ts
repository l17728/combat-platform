import { test, expect } from "@playwright/test";
import { API, waitForDrawer } from "./helpers";

// v2.3.4: 攻关详情页字段全部由 schema 派生。
// 这组测试:
//   1) 通过 API 在 schema 上动态加一个字段(addField + updateField group/order);
//   2) 在 attack/<id> 页面验证该字段渲染在「基础信息」Tab 的对应分组;
//   3) 通过编辑抽屉填入值,保存后页面重新加载,值持久化;
//   4) 清理 schema 字段。
test.describe("schema-driven AttackDetail (v2.3.4)", () => {
  const fieldName = "e2e分组字段_" + Date.now().toString(36);
  const groupName = "E2E自定义分组";
  let ticketId = "";

  test.beforeAll(async ({ request }) => {
    // 1) 给 attackTicket 加一个字段并归入 E2E 分组
    const add = await request.patch(`${API}/api/schema/attackTicket`, {
      headers: { "Content-Type": "application/json", "X-Role": "admin" },
      data: {
        op: "addField",
        field: { name: fieldName, type: "string", label: fieldName, group: groupName, order: 1 },
      },
    });
    expect(add.ok()).toBeTruthy();

    // 2) 建一个攻关单
    const create = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: "schema驱动测试单 " + fieldName, 状态: "进行中" },
    });
    expect(create.ok()).toBeTruthy();
    ticketId = (await create.json()).id;
  });

  test.afterAll(async ({ request }) => {
    // 清理:删除攻关单 + 删除字段(retire)。
    // 不直接删字段是因为后端目前没暴露 deleteField,retire 等价于在 UI 隐藏。
    if (ticketId) {
      await request.delete(`${API}/api/nodes/${ticketId}`, { headers: { "X-Role": "admin" } }).catch(() => {});
    }
    await request
      .patch(`${API}/api/schema/attackTicket`, {
        headers: { "Content-Type": "application/json", "X-Role": "admin" },
        data: { op: "retire", id: fieldName },
      })
      .catch(() => {});
  });

  test("new field appears in 基础信息 tab under its group card", async ({ page }) => {
    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState("domcontentloaded");

    // 默认进来在「基础信息」tab
    await page.getByRole("tab", { name: "基础信息" }).click();

    // 找到 group card —— Card title 是 E2E自定义分组
    const groupCard = page.locator(".ant-card").filter({ hasText: groupName });
    await expect(groupCard.first()).toBeVisible({ timeout: 5000 });
    // 在分组卡片里能看到字段 label
    await expect(groupCard.first().getByText(fieldName).first()).toBeVisible();
  });

  test("edit drawer renders the schema-added field and persists value", async ({ page }) => {
    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState("domcontentloaded");

    await page.getByRole("button", { name: "编辑信息" }).click();
    await waitForDrawer(page);

    const drawer = page.locator(".ant-drawer");
    // schema 字段在 drawer 里渲染为 Form.Item;label 与字段 name 相同
    // 注:Form.Item 子级 Input 没有 native <label htmlFor>,用 placeholder + scope 定位更稳
    const formItem = drawer.locator(".ant-form-item").filter({ hasText: fieldName });
    await expect(formItem).toBeVisible({ timeout: 5000 });
    const input = formItem.locator("input").first();
    await expect(input).toBeVisible();

    const newValue = "schema驱动值_" + Date.now().toString(36);
    await input.fill(newValue);
    await drawer.getByRole("button", { name: /保\s?存/ }).click();

    // 等抽屉关闭
    await expect(drawer).not.toBeVisible({ timeout: 5000 });

    // 重新加载,验证值持久化(基础信息 tab 里的分组卡能看到新值)
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await page.getByRole("tab", { name: "基础信息" }).click();
    const groupCard = page.locator(".ant-card").filter({ hasText: groupName });
    await expect(groupCard.first().getByText(newValue)).toBeVisible({ timeout: 5000 });
  });
});
