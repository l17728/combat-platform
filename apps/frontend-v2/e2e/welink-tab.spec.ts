import { test, expect } from '@playwright/test';
import { API } from './helpers.js';

const SAMPLE_MESSAGES = {
  messages: [
    { messageId: 'w1', sentAt: '2026-05-29T10:00:00Z', author: '张三', content: '你好,我开始排查 OOM 问题' },
    { messageId: 'w2', sentAt: '2026-05-29T10:01:00Z', author: '李四', content: '我也在看' },
    { messageId: 'w3', sentAt: '2026-05-29T10:02:00Z', author: '王五', content: '吃饭了吗' },
  ],
};

test.describe('Welink 消息 Tab', () => {
  let ticketId: string;

  test.beforeEach(async ({ page }) => {
    const res = await page.request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E Welink 测试', 状态: '处理中' },
    });
    const ticket = await res.json();
    ticketId = ticket.id;
  });

  test('Welink tab 可见并显示空态', async ({ page }) => {
    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');

    const tab = page.getByRole('tab', { name: /Welink 消息/ });
    await expect(tab).toBeVisible();
    await tab.click();

    await expect(page.getByText(/上传由 Welink 下载工具导出/)).toBeVisible();
    await expect(page.getByText(/暂无 Welink 消息/)).toBeVisible();
    await expect(page.getByRole('button', { name: /让 AI 分析/ })).toBeVisible();
  });

  test('上传 JSON → 列表显示 → 单条删除 → 批量删除', async ({ page }) => {
    // 预先用 API 上传消息(模拟拖拽上传后的状态),避免 FileChooser 依赖
    const upRes = await page.request.post(`${API}/api/tickets/${ticketId}/welink-messages`, {
      data: SAMPLE_MESSAGES,
    });
    expect(upRes.ok()).toBeTruthy();

    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: /Welink 消息/ }).click();

    // 统计行可见
    await expect(page.getByText(/共 3 条/).first()).toBeVisible();
    await expect(page.getByText(/纳入分析 3 条/)).toBeVisible();

    // 三条消息可见
    await expect(page.getByText(/我开始排查 OOM 问题/)).toBeVisible();
    await expect(page.getByText('我也在看')).toBeVisible();
    await expect(page.getByText('吃饭了吗')).toBeVisible();

    // 单条删除:删第三行
    const rows = page.locator('.ant-table-tbody > tr.ant-table-row');
    await rows.nth(2).getByText('删除').click();
    await page.getByRole('button', { name: /确\s?定/ }).click();
    await expect(page.getByText(/已删除/).first()).toBeVisible();
    await expect(page.getByText(/共 2 条/).first()).toBeVisible();

    // 批量删除:全选当前 + 批量删除
    await page.getByRole('button', { name: /全选当前/ }).click();
    await page.getByRole('button', { name: /批量删除 \(2\)/ }).click();
    await page.getByRole('button', { name: /确\s?定/ }).click();
    await expect(page.getByText(/已删除 2 条/).first()).toBeVisible();
    await expect(page.getByText(/共 0 条/).first()).toBeVisible();
  });

  test('纳入/排除分析 + AI 分析触发抽取(0 条时提示)', async ({ page }) => {
    await page.request.post(`${API}/api/tickets/${ticketId}/welink-messages`, {
      data: SAMPLE_MESSAGES,
    });

    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: /Welink 消息/ }).click();

    await expect(page.getByText(/共 3 条/).first()).toBeVisible();

    // 全选 + 点「排除分析」让 selected 变为 0
    await page.getByRole('button', { name: /全选当前/ }).click();
    await page.getByRole('button', { name: /排除分析 \(3\)/ }).click();
    await expect(page.getByText(/纳入分析 0 条/)).toBeVisible();

    // 让 AI 分析 → 由于 selected=0,toast 提示先勾选
    await page.locator('[data-testid="welink-analyze-btn"]').click();
    await expect(page.getByText(/没有已选中的消息可供分析/).first()).toBeVisible();
  });

  test('上传 JSON 文件(拖拽区) → 解析并入库', async ({ page }) => {
    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: /Welink 消息/ }).click();

    // 等待空态
    await expect(page.getByText(/暂无 Welink 消息/)).toBeVisible();

    // 通过 input[type=file] 注入文件
    const buffer = Buffer.from(JSON.stringify(SAMPLE_MESSAGES), 'utf-8');
    const fileInput = page.locator('input[type=file]').first();
    await fileInput.setInputFiles({
      name: 'welink.json',
      mimeType: 'application/json',
      buffer,
    });

    await expect(page.getByText(/上传完成/).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/共 3 条/).first()).toBeVisible();
    await expect(page.getByText(/我开始排查 OOM 问题/)).toBeVisible();
  });

  test('清空全部 → 列表归零', async ({ page }) => {
    await page.request.post(`${API}/api/tickets/${ticketId}/welink-messages`, {
      data: SAMPLE_MESSAGES,
    });

    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: /Welink 消息/ }).click();

    await expect(page.getByText(/共 3 条/).first()).toBeVisible();

    await page.getByRole('button', { name: /清空全部消息/ }).click();
    // Popconfirm 的确认按钮文本是 "清空"
    await page.getByRole('button', { name: /^清\s?空$/ }).click();

    await expect(page.getByText(/已清空/).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/共 0 条/).first()).toBeVisible();
  });
});
