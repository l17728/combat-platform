import { test, expect } from "@playwright/test";
import { API } from "./helpers";

// v2.3.5: 透视视图
test.describe("贡献录入 — 透视视图 (Pivot)", () => {
  test.beforeEach(async ({ page }) => {
    // 贡献等级字段需要 leader 角色;直接通过 init script 设定
    await page.addInitScript(() => localStorage.setItem("combat-role", "leader"));
  });

  async function createContribution(
    request: any,
    data: { 贡献人: string; 贡献等级: string; 贡献类型: string; 描述?: string }
  ) {
    await request.post(`${API}/api/nodes/contribution`, {
      headers: { "X-Role": "leader" },
      data: { 描述: "E2E", ...data },
    });
  }

  test("Segmented 切到透视,展示行列与小计", async ({ page, request }) => {
    await createContribution(request, { 贡献人: "E2E透视张三", 贡献等级: "核心", 贡献类型: "实施" });
    await createContribution(request, { 贡献人: "E2E透视张三", 贡献等级: "关键", 贡献类型: "实施" });
    await createContribution(request, { 贡献人: "E2E透视张三", 贡献等级: "普通", 贡献类型: "发现" });
    await createContribution(request, { 贡献人: "E2E透视李四", 贡献等级: "核心", 贡献类型: "发现" });

    await page.goto("/contributions");
    await page.locator(".ant-table").first().waitFor({ state: "visible", timeout: 10000 });

    const switcher = page.getByTestId("view-switcher");
    await expect(switcher).toBeVisible();
    await switcher.getByText("透视").click();

    await expect(page.getByTestId("contribution-pivot")).toBeVisible();

    // 行: 张三、李四 都应该出现(贡献人列)
    await expect(page.getByText("E2E透视张三")).toBeVisible();
    await expect(page.getByText("E2E透视李四")).toBeVisible();

    // 张三 实施 类型单元格 count = 2 (1核心 + 1关键)、score = 3+2=5
    const cell = page.getByTestId("pivot-cell-E2E透视张三-实施");
    await expect(cell).toBeVisible();
    await expect(cell).toContainText("2");
    await expect(cell).toContainText("5 分");

    // 张三 小计 = 3次, 3+2+1=6 分
    const total = page.getByTestId("pivot-row-total-E2E透视张三");
    await expect(total).toContainText("3");
    await expect(total).toContainText("6 分");

    // 列尾 总计行 出现
    await expect(page.getByTestId("pivot-grand-row")).toBeVisible();

    // 右下角 grand total = 4 条
    await expect(page.getByTestId("pivot-grand-total")).toContainText("4");

    // URL 同步
    await expect(page).toHaveURL(/view=pivot/);
  });

  test("URL ?view=pivot 直接进入透视", async ({ page, request }) => {
    await createContribution(request, { 贡献人: "E2E直链透视", 贡献等级: "核心", 贡献类型: "实施" });
    await page.goto("/contributions?view=pivot");
    await expect(page.getByTestId("contribution-pivot")).toBeVisible();
    await expect(page.getByText("E2E直链透视")).toBeVisible();
  });

  test("切到团队透视(Segmented within pivot)", async ({ page, request }) => {
    await request.post(`${API}/api/nodes/teamContribution`, {
      headers: { "X-Role": "leader" },
      data: { 团队名称: "E2E透视团队A", 贡献等级: "核心", 贡献类型: "实施", 描述: "E2E", 组长: "张三" },
    });
    await page.goto("/contributions?view=pivot");
    await expect(page.getByTestId("contribution-pivot")).toBeVisible();
    // 默认 person 视图,看不到团队名
    await expect(page.getByText("E2E透视团队A")).not.toBeVisible();
    // 切到团队
    const inner = page.getByTestId("contribution-pivot").locator(".ant-segmented");
    await inner.getByText("团队贡献").click();
    await expect(page.getByText("E2E透视团队A")).toBeVisible();
  });
});
