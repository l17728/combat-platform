import { test, expect } from "@playwright/test";
import { API, selectOption } from "./helpers";

test.describe("LLM 设置 - v2.3.4", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/llm-settings");
    await page.waitForLoadState("networkidle");
  });

  test("页面渲染所有关键字段", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /LLM 设置/ })).toBeVisible();
    await expect(page.getByText("Provider 提供商")).toBeVisible();
    await expect(page.getByText("baseURL")).toBeVisible();
    await expect(page.getByText(/apiKey/).first()).toBeVisible();
    await expect(page.getByText("defaultModel 主模型")).toBeVisible();
    await expect(page.getByText("thinking 思考模式")).toBeVisible();
    await expect(page.getByText("maxHops 工具最大轮数")).toBeVisible();
    await expect(page.getByText("timeoutMs 单次超时(ms)")).toBeVisible();
    await expect(page.getByRole("button", { name: /测试连接/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /保\s?存/ })).toBeVisible();
  });

  test("切换 provider 自动回填 baseURL + model 默认", async ({ page }) => {
    const providerSelect = page.locator(".ant-select").nth(0);
    await selectOption(page, providerSelect, "华为云");
    const baseUrl = page.getByLabel("baseURL");
    await expect(baseUrl).toHaveValue(/modelarts/);
  });

  test("修改 defaultModel + 保存 + GET 返回新值", async ({ page }) => {
    const model = page.getByLabel("defaultModel 主模型");
    await model.fill("glm-4.6-e2e-test");
    await page.getByRole("button", { name: /保\s?存/ }).click();
    await expect(page.getByText("保存成功").first()).toBeVisible({ timeout: 10000 });
    // 直接打 API 校验 round-trip
    const resp = await page.request.get(`${API}/api/llm-settings`);
    expect(resp.ok()).toBe(true);
    const body = await resp.json();
    expect(body.defaultModel).toBe("glm-4.6-e2e-test");
  });

  test("测试连接按钮可点击 + 触发 message(成功或失败均可)", async ({ page }) => {
    // 先填一个伪 apiKey 让测试有路径走完
    await page.getByLabel("baseURL").fill("https://example-not-exist.test/v4");
    const apiKey = page.getByLabel(/apiKey/);
    await apiKey.fill("dummy-key-for-test");
    await page.getByRole("button", { name: /测试连接/ }).click();
    // 不假定网络可达,只验证 UI 出现了反馈 message
    const feedback = page.getByText(/连接成功|连接失败|HTTP|缺少|未知错误|测试失败/).first();
    await expect(feedback).toBeVisible({ timeout: 15000 });
  });

  // §v2.3.5: 「刷新模型列表」按钮 + 动态 Select 注入
  test("刷新模型列表按钮存在 + 点击后触发 API 调用并显示反馈", async ({ page }) => {
    // 拦截 /api/llm-settings/models — mock 返回 3 个模型
    await page.route("**/api/llm-settings/models", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          models: [
            { id: "mock-fast-1", owned_by: "mock" },
            { id: "mock-pro-2", owned_by: "mock" },
            { id: "mock-flash-3", owned_by: "mock" },
          ],
        }),
      });
    });

    const refreshBtn = page.getByRole("button", { name: /刷新模型列表/ });
    await expect(refreshBtn).toBeVisible();
    await refreshBtn.click();

    // 成功 message 出现
    await expect(page.getByText(/已刷新 3 个模型/).first()).toBeVisible({ timeout: 10000 });

    // 提示文本切到「已从 provider 拉取」
    await expect(page.getByText(/已从 provider 拉取 3 个真实模型/).first()).toBeVisible();
  });

  test("刷新失败时降级 + warning message", async ({ page }) => {
    await page.route("**/api/llm-settings/models", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ error: "HTTP 401: Unauthorized" }),
      });
    });
    await page.getByRole("button", { name: /刷新模型列表/ }).click();
    await expect(page.getByText(/刷新失败.*401/).first()).toBeVisible({ timeout: 10000 });
    // 仍保留内置常用列表提示
    await expect(page.getByText(/常用.*glm-4-flash/).first()).toBeVisible();
  });
});
