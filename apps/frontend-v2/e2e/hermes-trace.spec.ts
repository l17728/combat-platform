import { test, expect } from "@playwright/test";

/**
 * v2.3.3 桶 C — Hermes 工具调用过程展开 UI。
 *
 * 后端 /api/hermes/ask 升级后返回 trace[]/engine/fallback_reason 三个新字段
 * (向后兼容,旧接口无该字段时不渲染)。
 *
 * 本测试用 page.route mock 后端响应,验证:
 *  1) 默认折叠 — 折叠头展示 步骤数 + 总耗时
 *  2) 展开后展示每步 tool 名 / size / ms,带入参出参可二次展开
 *  3) engine='tool' 显示蓝色 badge "工具调用",engine='intent' 显示灰色 "规则路由"
 *  4) fallback_reason 黄色警告显示
 *  5) 旧 response(无 trace)完全不渲染 trace 区(优雅降级)
 */

const TRACE_RESPONSE = {
  question: "PB-001 是谁负责?",
  intent: "tool",
  engine: "tool",
  answer: "PB-001 当前负责人是 **张三**。",
  citations: [{ nodeId: "n1", nodeType: "attackTicket", summary: "PB-001 攻关单", link: "/attack/n1" }],
  trace: [
    { tool: "search_tickets", input: { q: "PB-001" }, outputSize: 1024, ms: 120 },
    { tool: "get_ticket_owner", input: { ticketId: "n1" }, outputSize: 256, ms: 80 },
    { tool: "get_person_brief", input: { personId: "p-zhangsan" }, outputSize: 32768, ms: 950, _truncated: true },
  ],
};

const FALLBACK_RESPONSE = {
  question: "随便问",
  intent: "person_brief",
  engine: "intent",
  answer: "未找到匹配。",
  citations: [],
  trace: [{ tool: "intent_router", input: { q: "随便问" }, outputSize: 64, ms: 12 }],
  fallback_reason: "agent timeout, fell back to rule engine",
};

const LEGACY_RESPONSE = {
  question: "传统问题",
  intent: "person_brief",
  answer: "传统答复。",
  citations: [{ nodeId: "n9", nodeType: "person", summary: "李四", link: "/people" }],
};

async function openChatAndAsk(page: import("@playwright/test").Page, question: string): Promise<void> {
  await page.goto("/contributions");
  await page.locator(".ant-float-btn:has(.anticon-robot)").first().click();
  const list = page.getByTestId("hermes-chat-list");
  await expect(list).toBeVisible();
  const textarea = page.locator(".ant-input").last();
  await textarea.fill(question);
  await textarea.press("Enter");
}

test.describe("HermesChat trace UI (v2.3.3)", () => {
  test("trace 区默认折叠,折叠头显示步骤数和总耗时", async ({ page }) => {
    await page.route("**/api/hermes/ask", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(TRACE_RESPONSE),
      })
    );

    await openChatAndAsk(page, "PB-001 是谁负责?");

    const traceHeader = page.getByTestId("hermes-trace-header");
    await expect(traceHeader).toBeVisible({ timeout: 10000 });
    // 3 步,总 1150ms
    await expect(traceHeader).toContainText("3");
    await expect(traceHeader).toContainText(/1150|115\d/);

    // 默认折叠 — 步骤面板不可见
    await expect(page.getByTestId("hermes-trace-step-0")).toHaveCount(0);
  });

  test("展开 trace 后显示每步 tool 名/入参 size/出参 size/耗时,带截断标记", async ({ page }) => {
    await page.route("**/api/hermes/ask", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(TRACE_RESPONSE),
      })
    );

    await openChatAndAsk(page, "PB-001 是谁负责?");

    const traceHeader = page.getByTestId("hermes-trace-header");
    await expect(traceHeader).toBeVisible({ timeout: 10000 });

    // engine='tool' badge
    await expect(page.getByTestId("hermes-engine-badge")).toContainText("工具调用");

    // 展开
    await traceHeader.click();

    const step0 = page.getByTestId("hermes-trace-step-0");
    const step1 = page.getByTestId("hermes-trace-step-1");
    const step2 = page.getByTestId("hermes-trace-step-2");
    await expect(step0).toContainText("search_tickets");
    await expect(step0).toContainText("120");
    await expect(step1).toContainText("get_ticket_owner");
    await expect(step1).toContainText("80");
    await expect(step2).toContainText("get_person_brief");
    await expect(step2).toContainText("950");
    // 第三步出参 32KB 被截断,展示截断徽标
    await expect(step2).toContainText("截断");

    // 点击某步进一步展开入参/出参 JSON
    await step0.getByTestId("hermes-trace-step-toggle").click();
    await expect(step0.locator("pre")).toContainText("search_tickets");
    await expect(step0.locator("pre")).toContainText("PB-001");
  });

  test("engine='intent' + fallback_reason 显示规则路由 badge + 黄色提示", async ({ page }) => {
    await page.route("**/api/hermes/ask", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(FALLBACK_RESPONSE),
      })
    );

    await openChatAndAsk(page, "随便问");

    await expect(page.getByTestId("hermes-engine-badge")).toContainText("规则路由");
    const warn = page.getByTestId("hermes-fallback-reason");
    await expect(warn).toBeVisible();
    await expect(warn).toContainText("agent timeout");
  });

  test("旧 response 无 trace/engine — 完全不渲染 trace 区(优雅降级)", async ({ page }) => {
    await page.route("**/api/hermes/ask", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(LEGACY_RESPONSE),
      })
    );

    await openChatAndAsk(page, "传统问题");

    // 答复正文渲染了
    await expect(page.getByText("传统答复。")).toBeVisible({ timeout: 10000 });
    // 但 trace 头部和 engine badge 都不应出现
    await expect(page.getByTestId("hermes-trace-header")).toHaveCount(0);
    await expect(page.getByTestId("hermes-engine-badge")).toHaveCount(0);
    await expect(page.getByTestId("hermes-fallback-reason")).toHaveCount(0);
  });
});
