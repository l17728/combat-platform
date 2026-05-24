import { test, expect } from '@playwright/test';

const API = 'http://localhost:3001';

test.describe('攻关作战台', () => {
  test('shows empty state when no tickets', async ({ page }) => {
    await page.goto('/attack');
    await expect(page.getByText('攻关作战台')).toBeVisible();
    await expect(page.getByText('新建攻关')).toBeVisible();
  });

  test('creates a new ticket and shows in list', async ({ page }) => {
    await page.goto('/attack');
    await page.getByRole('button', { name: '新建攻关' }).click();
    await expect(page.getByText('新建攻关任务')).toBeVisible();

    await page.getByLabel('标题').fill('E2E测试攻关单');
    await page.getByRole('button', { name: '创建' }).click();
    await expect(page.getByText('创建成功')).toBeVisible();
  });

  test('lists created tickets', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E列表测试单', 状态: '进行中', 当前处理人: '张三' },
    });

    await page.goto('/attack');
    await expect(page.getByText('E2E列表测试单')).toBeVisible();
    await expect(page.getByText('进行中')).toBeVisible();
  });

  test('filters by status', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E过滤待响应', 状态: '待响应' },
    });
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E过滤已解决', 状态: '已解决' },
    });

    await page.goto('/attack');
    await expect(page.getByText('E2E过滤待响应')).toBeVisible();
    await expect(page.getByText('E2E过滤已解决')).toBeVisible();

    await page.getByRole('combobox').first().click();
    await page.getByText('待响应', { exact: true }).click();
    await expect(page.getByText('E2E过滤已解决')).toHaveCount(0);
  });

  test('searches by keyword', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E搜索专用单', 状态: '处理中' },
    });

    await page.goto('/attack');
    await page.getByPlaceholder('搜索标题/单号/处理人').fill('搜索专用');
    await expect(page.getByText('E2E搜索专用单')).toBeVisible();
  });
});

test.describe('攻关详情', () => {
  test('shows ticket detail and progress timeline', async ({ page, request }) => {
    const res = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E详情测试', 状态: '处理中', 当前处理人: '李四', 问题单号: 'TS20260524001' },
    });
    const ticket = await res.json();
    await request.post(`${API}/api/nodes/${ticket.id}/progress`, {
      data: { content: '首次排查进展', statusSnapshot: '处理中', actor: 'e2e' },
    });

    await page.goto(`/attack/${ticket.id}`);
    await expect(page.getByText('E2E详情测试')).toBeVisible();
    await expect(page.getByText('TS20260524001')).toBeVisible();
    await expect(page.getByText('首次排查进展')).toBeVisible();
  });

  test('appends progress', async ({ page, request }) => {
    const res = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E进展追加', 状态: '处理中' },
    });
    const ticket = await res.json();

    await page.goto(`/attack/${ticket.id}`);
    await page.getByRole('button', { name: '追加进展' }).click();
    await page.getByPlaceholder('描述当前进展...').fill('E2E追加的进展内容');
    await page.getByRole('button', { name: '提交进展' }).click();
    await expect(page.getByText('进展已追加')).toBeVisible();
  });

  test('transitions status', async ({ page, request }) => {
    const res = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E状态流转', 状态: '待响应' },
    });
    const ticket = await res.json();

    await page.goto(`/attack/${ticket.id}`);
    await page.getByRole('button', { name: '状态流转' }).click();
    await page.getByRole('combobox').click();
    await page.getByText('处理中').click();
    await page.getByRole('button', { name: '确认流转' }).click();
    await expect(page.getByText('状态流转成功')).toBeVisible();
  });

  test('deletes a ticket with confirmation', async ({ page, request }) => {
    const res = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E待删除单', 状态: '待响应' },
    });
    const ticket = await res.json();

    await page.goto('/attack');
    await page.getByText('E2E待删除单').isVisible();
    await page.getByRole('button', { name: '删除' }).first().click();
    await page.getByRole('button', { name: '确认' }).click();
    await expect(page.getByText('删除成功')).toBeVisible();
  });
});
