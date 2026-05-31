import { test, expect } from "@playwright/test";
import { API } from "./helpers.js";

/**
 * 场景 3:Welink 群消息问答带可点击溯源。
 *
 * 验证两条主链路:
 *  1) 后端 /api/hermes/ask 在规则引擎下,问群消息相关问题时返回 kind='welink' citation,
 *     带真实存在的 messageId(后端兜底:关键词扫 welink_messages 排前 3 条)。
 *  2) UI:访问 /attack/<id>?tab=welink&welinkMsg=<某真实msgId>,自动切到 Welink Tab
 *     的聊天视图,滚动到该消息并加黄色背景高亮。
 *
 * 实现:agent 通常关(COMBAT_NO_AUTH=1 + 无 HERMES_AGENT),走规则引擎+welink 兜底。
 */

const SAMPLE_MESSAGES = {
  messages: [
    { messageId: "cite-w1", sentAt: "2026-05-29T09:00:00Z", author: "张三", content: "我开始排查 OOM 问题了" },
    { messageId: "cite-w2", sentAt: "2026-05-29T09:05:00Z", author: "小王", content: "我也介入一起看,先查日志" },
    { messageId: "cite-w3", sentAt: "2026-05-29T09:10:00Z", author: "李四", content: "今天天气不错" },
    { messageId: "cite-w4", sentAt: "2026-05-29T09:15:00Z", author: "小王", content: "OOM 大概率是泄漏,继续追" },
  ],
};

test.describe("Welink 场景 3 — Hermes 溯源", () => {
  let ticketId: string;

  test.beforeEach(async ({ page }) => {
    const res = await page.request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: "E2E Welink 溯源", 状态: "处理中" },
    });
    const ticket = await res.json();
    ticketId = ticket.id;
    const up = await page.request.post(`${API}/api/tickets/${ticketId}/welink-messages`, {
      data: SAMPLE_MESSAGES,
    });
    expect(up.ok()).toBeTruthy();
  });

  test("后端 /hermes/ask 对群消息问题返回 kind=welink citation", async ({ page }) => {
    const res = await page.request.post(`${API}/api/hermes/ask`, {
      data: {
        question: "群里谁最早提到 OOM?",
        context: `当前攻关单 ticketId=${ticketId};用户在 Welink 群消息场景`,
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body.citations)).toBe(true);

    const welinkCites = (body.citations || []).filter((c: any) => c.kind === "welink");
    expect(welinkCites.length).toBeGreaterThan(0);

    // 每条 welink citation 必须带真实存在的 messageId(OOM 关键词命中 cite-w1/cite-w4)
    const ids = welinkCites.map((c: any) => c.messageId);
    expect(ids).toEqual(expect.arrayContaining(["cite-w1"]));
    // link 必须指向带 welinkMsg query 的攻关详情,以便前端能跳转高亮
    for (const c of welinkCites) {
      expect(c.link).toContain(`/attack/${ticketId}`);
      expect(c.link).toContain("welinkMsg=");
      expect(c.ticketId).toBe(ticketId);
    }
  });

  test("访问 ?welinkMsg=<id> 自动切到 Welink 聊天视图并高亮消息", async ({ page }) => {
    // 直接命中场景 3 的入口 URL
    await page.goto(`/attack/${ticketId}?tab=welink&welinkMsg=cite-w2`);
    await page.waitForLoadState("networkidle");

    // Welink Tab 自动激活
    const welinkTabPanel = page.locator('[data-testid="welink-chat-view"]');
    await expect(welinkTabPanel).toBeVisible({ timeout: 10000 });

    // 等到消息列表加载完并 scrollIntoView 触发
    const highlightedBubble = page.locator('[data-welink-msg-id="cite-w2"]');
    await expect(highlightedBubble).toBeVisible({ timeout: 10000 });

    // 高亮类生效(2 秒内有效)
    await expect(highlightedBubble).toHaveClass(/welink-msg-highlight/);
  });

  test("AI 助手浮窗里 welink citation 可点击 → 跳转并高亮", async ({ page }) => {
    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState("networkidle");

    // 切到 Welink Tab,触发浮窗按钮渲染
    await page.getByRole("tab", { name: /Welink 消息/ }).click();
    // 点击浮窗触发按钮(WelinkTab 内嵌的 HermesChat 浮窗 trigger)
    await page.getByTestId("welink-hermes-trigger").click();

    // 输入群消息相关问题,触发后端返回 welink citation
    const textarea = page.locator(".ant-input").last();
    await textarea.fill("群里谁最早提到 OOM?");
    // 通过 Enter 提交(WelinkTab 的 HermesChat 配置了 onPressEnter)
    await textarea.press("Enter");

    // 等待 welink citation tag 出现
    const welinkTag = page.locator('[data-testid="hermes-welink-citation"]').first();
    await expect(welinkTag).toBeVisible({ timeout: 15000 });

    // 点击 tag → 浮窗关闭,导航到带 welinkMsg query 的同一攻关单(SPA 内跳转)
    await welinkTag.click();

    // SPA 跳转后,chat view + 高亮气泡可见
    await expect(page.locator('[data-testid="welink-chat-view"]')).toBeVisible({ timeout: 10000 });
    const highlighted = page.locator(".welink-msg-highlight").first();
    await expect(highlighted).toBeVisible({ timeout: 10000 });
  });
});
