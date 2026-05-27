import { test, expect } from '@playwright/test';
import { API, selectOption } from './helpers.js';

function btn(name: string) {
  return { name: new RegExp(name.split('').join('\\s?')) };
}

test.describe('动态标签', () => {
  let ticketId: string;

  test.beforeEach(async ({ page }) => {
    const res = await page.request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E动态标签测试', 状态: '待响应' },
    });
    const ticket = await res.json();
    ticketId = ticket.id;
  });

  test('页面渲染 - 添加标签按钮可见', async ({ page }) => {
    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('tab', { name: /基础信息/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /添加标签/ })).toBeVisible();
  });

  test('添加关联数据标签', async ({ page }) => {
    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /添加标签/ }).click();
    const modal = page.locator('.ant-modal').filter({ hasText: '添加标签' });
    await expect(modal).toBeVisible();

    await modal.getByRole('radio', { name: '关联数据' }).click();
    await modal.getByPlaceholder(/相关贡献/).fill('E2E测试关联');
    await modal.getByRole('button', btn('创建')).click();

    await expect(page.getByText('标签已创建').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('tab', { name: /E2E测试关联/ })).toBeVisible();
  });

  test('添加自定义笔记标签', async ({ page }) => {
    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /添加标签/ }).click();
    const modal = page.locator('.ant-modal').filter({ hasText: '添加标签' });
    await expect(modal).toBeVisible();

    await modal.getByRole('radio', { name: '自定义笔记' }).click();
    await modal.getByPlaceholder(/会议笔记/).fill('E2E测试笔记');
    await modal.getByRole('button', btn('创建')).click();

    await expect(page.getByText('标签已创建').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('tab', { name: /E2E测试笔记/ })).toBeVisible();
  });

  test('自定义笔记标签 - 编辑器可见', async ({ page }) => {
    await page.request.post(`${API}/api/tickets/${ticketId}/tabs`, {
      data: { tabType: 'custom', title: '编辑器测试' },
    });

    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');

    await page.getByRole('tab', { name: /编辑器测试/ }).click();
    await expect(page.getByPlaceholder('输入 Markdown 内容...')).toBeVisible();
    await expect(page.getByRole('button', { name: /AI助手/ })).toBeVisible();
  });

  test('自定义笔记标签 - 输入并预览 Markdown', async ({ page }) => {
    await page.request.post(`${API}/api/tickets/${ticketId}/tabs`, {
      data: { tabType: 'custom', title: 'MD预览测试', content: '' },
    });

    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');

    await page.getByRole('tab', { name: /MD预览测试/ }).click();
    const textarea = page.getByPlaceholder('输入 Markdown 内容...');
    await textarea.fill('# Hello World\nThis is a test.');
    await expect(page.getByText('Hello World')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('This is a test.')).toBeVisible();
  });

  test('关联数据标签 - 显示空状态', async ({ page }) => {
    await page.request.post(`${API}/api/tickets/${ticketId}/tabs`, {
      data: { tabType: 'link', title: '关联测试', config: {} },
    });

    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');

    await page.getByRole('tab', { name: /关联测试/ }).click();
    await expect(page.getByText(/暂无/)).toBeVisible({ timeout: 5000 });
  });

  test('删除动态标签', async ({ page }) => {
    await page.request.post(`${API}/api/tickets/${ticketId}/tabs`, {
      data: { tabType: 'custom', title: '待删除标签' },
    });

    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');

    await page.getByRole('tab', { name: /待删除标签/ }).click();
    await page.getByRole('button', { name: /删除标签/ }).click();
    await page.getByRole('button', { name: /确\s?定/ }).click();

    await expect(page.getByText('标签已删除').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('tab', { name: /待删除标签/ })).not.toBeVisible({ timeout: 5000 });
  });

  test('多个动态标签按顺序显示', async ({ page }) => {
    await page.request.post(`${API}/api/tickets/${ticketId}/tabs`, {
      data: { tabType: 'custom', title: '标签A' },
    });
    await page.request.post(`${API}/api/tickets/${ticketId}/tabs`, {
      data: { tabType: 'link', title: '标签B' },
    });

    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');

    const allTabs = page.getByRole('tab');
    const tabTexts = await allTabs.allTextContents();
    const fixedLabels = ['基础信息', '进展同步', '日报更新', '历史记录', '求助网络'];
    const lastFixedIndex = Math.max(...fixedLabels.map(l => tabTexts.findIndex(t => t.includes(l))));
    expect(tabTexts[lastFixedIndex + 1]).toContain('标签A');
    expect(tabTexts[lastFixedIndex + 2]).toContain('标签B');
  });

  test('关闭添加标签弹窗不创建数据', async ({ page }) => {
    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /添加标签/ }).click();
    const modal = page.locator('.ant-modal').filter({ hasText: '添加标签' });
    await expect(modal).toBeVisible();

    await modal.getByPlaceholder(/相关贡献/).fill('不应创建的数据');
    await modal.getByRole('button', { name: /取\s?消/ }).click();
    await expect(modal).not.toBeVisible();

    const res = await page.request.get(`${API}/api/tickets/${ticketId}/tabs`);
    const tabs = await res.json();
    expect(tabs).toHaveLength(0);
  });

  test('添加标签 - 标签名为空时校验失败', async ({ page }) => {
    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /添加标签/ }).click();
    const modal = page.locator('.ant-modal').filter({ hasText: '添加标签' });
    await expect(modal).toBeVisible();

    await modal.getByRole('button', btn('创建')).click();
    await expect(modal.getByText('请输入标签名称')).toBeVisible();
  });

  test('自定义标签 - AI助手面板可展开收起', async ({ page }) => {
    await page.request.post(`${API}/api/tickets/${ticketId}/tabs`, {
      data: { tabType: 'custom', title: 'AI测试' },
    });

    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');

    await page.getByRole('tab', { name: /AI测试/ }).click();

    await page.getByRole('button', { name: /AI助手/ }).click();
    await expect(page.getByPlaceholder(/提问/)).toBeVisible();

    await page.getByRole('button', { name: /收起AI助手/ }).click();
    await expect(page.getByPlaceholder(/提问/)).not.toBeVisible();
  });

  test('标签在不同攻关单间独立', async ({ page }) => {
    const res2 = await page.request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: '第二个攻关单', 状态: '待响应' },
    });
    const ticket2 = await res2.json();

    await page.request.post(`${API}/api/tickets/${ticketId}/tabs`, {
      data: { tabType: 'custom', title: '仅第一个' },
    });

    await page.goto(`/attack/${ticket2}`);
    await page.waitForLoadState('networkidle');

    const allTabs = page.getByRole('tab');
    const tabTexts = await allTabs.allTextContents();
    expect(tabTexts.find(t => t.includes('仅第一个'))).toBeUndefined();
  });

  test('API直接创建的标签在页面可见', async ({ page }) => {
    await page.request.post(`${API}/api/tickets/${ticketId}/tabs`, {
      data: { tabType: 'custom', title: 'API创建标签', content: '# Test\nHello' },
    });

    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('tab', { name: /API创建标签/ })).toBeVisible();
    await page.getByRole('tab', { name: /API创建标签/ }).click();
    await expect(page.getByPlaceholder('输入 Markdown 内容...')).toHaveValue('# Test\nHello', { timeout: 5000 });
  });
});
