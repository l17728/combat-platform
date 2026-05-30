import { test, expect } from '@playwright/test';
import { API } from './helpers.js';

const SAMPLE_MESSAGES = {
  messages: [
    { messageId: 'x1', sentAt: '2026-05-29T10:00:00Z', author: '陈某', content: 'OOM 问题排查开始' },
    { messageId: 'x2', sentAt: '2026-05-29T10:01:00Z', author: '李某', content: '我看下 GC 日志' },
    { messageId: 'x3', sentAt: '2026-05-29T10:02:00Z', author: '王某', content: '已经复现' },
    { messageId: 'x4', sentAt: '2026-05-29T10:03:00Z', author: '赵某', content: '我去验证一下' },
  ],
};

test.describe('Welink AI 抽取 + 对话式补齐', () => {
  let ticketId: string;

  test.beforeEach(async ({ page }) => {
    const res = await page.request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E Welink 抽取', 状态: '处理中', 攻关组长: '陈某', 攻关成员: '陈某' },
    });
    const ticket = await res.json();
    ticketId = ticket.id;
    await page.request.post(`${API}/api/tickets/${ticketId}/welink-messages`, { data: SAMPLE_MESSAGES });
  });

  test('点「让 AI 分析」→ 后端返回非空 extractions + Drawer 自动打开', async ({ page }) => {
    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: /Welink 消息/ }).click();
    await expect(page.getByText(/共 4 条/).first()).toBeVisible();

    await page.locator('[data-testid="welink-analyze-btn"]').click();
    // toast 成功
    await expect(page.getByText(/AI 抽取完成/).first()).toBeVisible({ timeout: 15000 });

    // Drawer 自动打开
    const drawer = page.locator('.ant-drawer').filter({ hasText: 'AI 抽取结果' });
    await expect(drawer).toBeVisible();
    // 至少有 1 项
    await expect(drawer.locator('[data-testid="welink-extraction-item"]').first()).toBeVisible();
  });

  test('Drawer 分类 Tabs 可见;缺口 Tab 含未登记发言人', async ({ page }) => {
    // 用 API 直接触发抽取
    const an = await page.request.post(`${API}/api/tickets/${ticketId}/welink-messages/analyze`);
    expect(an.ok()).toBeTruthy();

    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: /Welink 消息/ }).click();

    // 打开 Drawer
    await page.locator('[data-testid="welink-open-extractions"]').click();
    const drawer = page.locator('.ant-drawer').filter({ hasText: 'AI 抽取结果' });
    await expect(drawer).toBeVisible();

    // 切到「缺口」
    await drawer.getByRole('tab', { name: /缺口/ }).click();
    // 应至少看到一条 gap 项;陈某已登记,所以李某 / 王某 / 赵某 之一应在缺口里
    const gapTab = drawer.locator('[data-testid="welink-extraction-tab-gap"]');
    await expect(gapTab.locator('[data-testid="welink-extraction-item"]').first()).toBeVisible();
  });

  test('点缺口里的「加入攻关成员」→ ticket 成员数 +1', async ({ page }) => {
    await page.request.post(`${API}/api/tickets/${ticketId}/welink-messages/analyze`);

    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: /Welink 消息/ }).click();
    await page.locator('[data-testid="welink-open-extractions"]').click();

    const drawer = page.locator('.ant-drawer').filter({ hasText: 'AI 抽取结果' });
    await expect(drawer).toBeVisible();
    await drawer.getByRole('tab', { name: /缺口/ }).click();

    const gapTab = drawer.locator('[data-testid="welink-extraction-tab-gap"]');
    const firstAddBtn = gapTab.locator('[data-testid="welink-add-member-btn"]').first();
    await expect(firstAddBtn).toBeVisible();
    await firstAddBtn.click();
    await expect(page.getByText(/已加入/).first()).toBeVisible({ timeout: 8000 });

    // 拉接口确认 ticket 成员变更
    const node = await page.request.get(`${API}/api/nodes/${ticketId}`);
    const json = await node.json();
    const members = JSON.parse(json.properties['成员列表'] || '[]');
    expect(members.length).toBeGreaterThanOrEqual(2);
  });

  test('AI 助手浮窗:打开 → greeting 可见 → 提问得到 fallback 回答', async ({ page }) => {
    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: /Welink 消息/ }).click();

    // 点浮动按钮(同一页可能有多个 FloatButton,通过 testId 锁定)
    await page.locator('[data-testid="welink-hermes-trigger"]').click();

    // greeting 主动出现
    await expect(page.getByText(/我可以帮你分析群里发言/).first()).toBeVisible();

    // 提问 → 由于 e2e backend 未开 HERMES_AGENT,走规则引擎 fallback-search
    const textArea = page.locator('.ant-input').last();
    await textArea.fill('谁先提的问题');
    // 浮窗内的「提问」按钮(SendOutlined 图标 + 文本)— 按 testarea 附近的最后一个 primary button
    await page.locator('.ant-btn-primary').filter({ hasText: /提\s?问/ }).first().click();

    // 规则引擎或 agent 都会返回 answer 字段;至少能看到非空回答(用户问句之外又出现 assistant 块)
    await expect(page.locator('.markdown-body').first()).toBeVisible({ timeout: 20000 });
  });

  test('对话式补齐:直接通过 welink/add-members API 验证成员补齐链路(模拟 agent 落点)', async ({ page }) => {
    // 这里直接打 add-members 端点,等价于 agent 在对话里调 hermes_welinkAddMembers 工具的最终落点;
    // e2e 不依赖 LLM 也能验证「从对话指令解析 → 加成员 → ticket 更新」的整条链路。
    const r = await page.request.post(`${API}/api/tickets/${ticketId}/welink/add-members`, {
      data: { names: ['李某', '王某'] },
    });
    expect(r.ok()).toBeTruthy();
    const body = await r.json();
    expect(body.added).toBe(2);

    // 进 ticket 详情看「成员管理」tab 内表格,新成员行应当可见
    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: /成员管理/ }).click();
    // 等成员表格出现
    const activePane = page.locator('.ant-tabs-tabpane-active');
    await expect(activePane.locator('.ant-table-row').first()).toBeVisible({ timeout: 10000 });
    await expect(activePane.getByText('李某', { exact: true }).first()).toBeVisible();
    await expect(activePane.getByText('王某', { exact: true }).first()).toBeVisible();
  });
});
