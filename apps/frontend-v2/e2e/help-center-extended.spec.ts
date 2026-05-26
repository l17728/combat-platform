import { test, expect } from '@playwright/test';
import { API, selectOption, selectOptionContaining, waitForDrawer, waitForTable } from './helpers';

test.describe('求助中心 - 扩展功能', () => {
  test('create help request with all fields', async ({ page }) => {
    await page.request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E完整求助测试单', 状态: '待响应' },
    });
    await page.request.post(`${API}/api/nodes/person`, {
      data: { 姓名: 'E2E求助目标人', 部门: '测试部门' },
    });

    await page.goto('/help');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: '发起求助' }).click();
    await waitForDrawer(page);

    const drawer = page.locator('.ant-drawer');
    const selects = drawer.locator('.ant-select');

    await selectOptionContaining(page, selects.nth(0), 'E2E完整求助测试单');
    await selectOptionContaining(page, selects.nth(1), 'E2E求助目标人');
    await selectOptionContaining(page, selects.nth(2), 'E2E求助目标人');
    await drawer.getByPlaceholder('email@example.com').fill('target@test.com');
    await selectOption(page, selects.nth(3), '环境');
    await drawer.getByPlaceholder('请描述您需要帮助的内容...').fill('E2E完整求助问题');
    await drawer.getByPlaceholder('可选').fill('E2E附加说明');

    await page.locator('.ant-drawer-extra button').click();
    await expect(page.getByText('求助已发送').first()).toBeVisible({ timeout: 10000 });
  });

  test('help request requires required fields', async ({ page }) => {
    await page.goto('/help');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: '发起求助' }).click();
    await waitForDrawer(page);

    await page.locator('.ant-drawer-extra button').click();

    await expect(page.locator('.ant-form-item-explain-error').first()).toBeVisible({ timeout: 5000 });
  });

  test('ticket link navigates to attack detail', async ({ page }) => {
    const ticketRes = await page.request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E链接导航测试单', 状态: '待响应' },
    });
    const ticket = await ticketRes.json();

    await page.request.post(`${API}/api/help-requests`, {
      data: {
        ticketId: ticket.id,
        requesterName: '链接测试人',
        targetEmail: 'link@test.com',
        category: '环境',
        question: '链接测试问题',
      },
    });

    await page.goto('/help');
    await page.waitForLoadState('networkidle');

    const link = page.locator('a').filter({ hasText: ticket.id.slice(0, 8) }).first();
    await expect(link).toBeVisible({ timeout: 10000 });
    await link.click();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(new RegExp(`/attack/${ticket.id}`));
  });

  test('status filter with data', async ({ page }) => {
    const ticketRes = await page.request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E筛选测试单', 状态: '待响应' },
    });
    const ticket = await ticketRes.json();

    await page.request.post(`${API}/api/help-requests`, {
      data: {
        ticketId: ticket.id,
        requesterName: '筛选测试人',
        targetEmail: 'filter@test.com',
        category: '环境',
        question: '筛选问题可见文本',
      },
    });

    await page.goto('/help');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('筛选问题可见文本')).toBeVisible({ timeout: 10000 });
  });

  test('drawer close discards data', async ({ page }) => {
    await page.goto('/help');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: '发起求助' }).click();
    await waitForDrawer(page);

    const drawer = page.locator('.ant-drawer');
    await drawer.getByPlaceholder('email@example.com').fill('E2E不应存在的邮箱');

    await page.locator('.ant-drawer-close').click();
    await expect(page.getByText('E2E不应存在的邮箱')).not.toBeVisible();
  });

  test('help button visible', async ({ page }) => {
    await page.goto('/help');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.anticon-question-circle').first()).toBeVisible();
  });
});
