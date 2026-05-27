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

    await modal.locator('label').filter({ hasText: /关联数据/ }).click();
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

    await modal.locator('label').filter({ hasText: /自定义笔记/ }).click();
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
    await expect(page.getByRole('heading', { name: 'Hello World' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('This is a test.').first()).toBeVisible();
  });

  test('关联数据标签 - 显示空状态', async ({ page }) => {
    await page.request.post(`${API}/api/tickets/${ticketId}/tabs`, {
      data: { tabType: 'link', title: '关联测试', config: {} },
    });

    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');

    await page.getByRole('tab', { name: /关联测试/ }).click();
    await expect(page.getByText('暂无关联数据数据')).toBeVisible({ timeout: 5000 });
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
    await expect(page.getByRole('tab', { name: /标签A/ })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('tab', { name: /标签B/ })).toBeVisible({ timeout: 5000 });

    const allTabs = page.getByRole('tab');
    const tabTexts = await allTabs.allTextContents();
    const idxA = tabTexts.findIndex(t => t.includes('标签A'));
    const idxB = tabTexts.findIndex(t => t.includes('标签B'));
    expect(idxA).toBeGreaterThanOrEqual(0);
    expect(idxB).toBeGreaterThanOrEqual(0);
    expect(idxA).toBeLessThan(idxB);
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

    await page.goto(`/attack/${ticket2.id}`);
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

  test('关联数据标签 - 带贡献数据显示', async ({ page }) => {
    await page.request.post(`${API}/api/nodes/contribution`, {
      data: { 标题: 'E2E测试贡献', 贡献人: '张三', 贡献类型: '技术' },
    });
    await page.request.post(`${API}/api/tickets/${ticketId}/tabs`, {
      data: { tabType: 'link', title: '相关贡献', config: { nodeType: 'contribution' } },
    });

    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');

    await page.getByRole('tab', { name: /相关贡献/ }).click();
    await expect(page.getByText('相关贡献').first()).toBeVisible({ timeout: 5000 });
  });

  test('切换固定标签和动态标签不报错', async ({ page }) => {
    await page.request.post(`${API}/api/tickets/${ticketId}/tabs`, {
      data: { tabType: 'custom', title: '动态Tab' },
    });

    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');

    await page.getByRole('tab', { name: /进展同步/ }).click();
    await expect(page.getByRole('button', { name: /追加进展/ })).toBeVisible();

    await page.getByRole('tab', { name: /动态Tab/ }).click();
    await expect(page.getByPlaceholder('输入 Markdown 内容...')).toBeVisible();

    await page.getByRole('tab', { name: /基础信息/ }).click({ force: true });
    await expect(page.getByText('E2E动态标签测试')).toBeVisible();
  });

  test('API reorder 后标签顺序正确', async ({ page }) => {
    const tabA = await (await page.request.post(`${API}/api/tickets/${ticketId}/tabs`, {
      data: { tabType: 'custom', title: '第一' },
    })).json();
    const tabB = await (await page.request.post(`${API}/api/tickets/${ticketId}/tabs`, {
      data: { tabType: 'custom', title: '第二' },
    })).json();

    await page.request.put(`${API}/api/tickets/${ticketId}/tabs/order`, {
      data: { order: [tabB.id, tabA.id] },
    });

    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');

    const allTabs = page.getByRole('tab');
    const tabTexts = await allTabs.allTextContents();
    const idx1 = tabTexts.findIndex(t => t.includes('第二'));
    const idx2 = tabTexts.findIndex(t => t.includes('第一'));
    expect(idx1).toBeLessThan(idx2);
  });

  test('删除关联数据标签确认弹窗可取消', async ({ page }) => {
    await page.request.post(`${API}/api/tickets/${ticketId}/tabs`, {
      data: { tabType: 'link', title: '取消删除测试' },
    });

    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');

    await page.getByRole('tab', { name: /取消删除测试/ }).click();
    await page.getByRole('button', { name: /删除标签/ }).click();
    await page.getByRole('button', { name: /取\s?消/ }).click();

    await expect(page.getByRole('tab', { name: /取消删除测试/ })).toBeVisible();
  });
});
