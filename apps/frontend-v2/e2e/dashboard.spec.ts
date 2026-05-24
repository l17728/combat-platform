import { test, expect } from '@playwright/test';
import { API, waitForTable } from './helpers';

test.describe('作战态势 Dashboard', () => {
  test('renders stats cards and empty state', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '作战态势' })).toBeVisible();
    await expect(page.locator('.ant-statistic-title', { hasText: /^进行中$/ })).toBeVisible();
    await expect(page.locator('.ant-statistic-title', { hasText: /^已闭环$/ })).toBeVisible();
    await expect(page.locator('.ant-statistic-title', { hasText: /^总攻关单$/ })).toBeVisible();
    await expect(page.locator('.ant-statistic-title', { hasText: /^今日进展$/ })).toBeVisible();
  });

  test('shows recent activity after ticket creation', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E看板测试单', 状态: '处理中' },
    });

    await page.goto('/');
    await expect(page.getByText('E2E看板测试单')).toBeVisible();
    await expect(page.getByText('处理中').first()).toBeVisible();
  });

  test('status distribution chart renders with data', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E状态分布单A', 状态: '待响应' },
    });
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E状态分布单B', 状态: '已解决' },
    });

    await page.goto('/');
    await expect(page.getByText('状态分布', { exact: true })).toBeVisible();
  });

  test('click recent ticket navigates to detail', async ({ page, request }) => {
    const res = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E跳转测试单', 状态: '处理中' },
    });
    const ticket = await res.json();

    await page.goto('/');
    await page.getByText('E2E跳转测试单').click();
    await expect(page).toHaveURL(new RegExp(`/attack/${ticket.id}`));
  });
});
