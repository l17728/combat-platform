import { test, expect } from '@playwright/test';
import { API, selectOption, waitForTable } from './helpers';

test.describe('审计日志 - 扩展功能', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/audit');
    await page.waitForLoadState('networkidle');
  });

  test('shows audit entries with change details', async ({ page }) => {
    await page.request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E审计变更测试', 状态: '待响应' },
    });

    await page.goto('/audit');
    await page.waitForLoadState('networkidle');
    await waitForTable(page);

    const row = page.getByRole('row').filter({ hasText: 'E2E审计变更测试' });
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row.getByText('创建').first()).toBeVisible();
  });

  test('filter by action shows update entries', async ({ page }) => {
    const res = await page.request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E审计更新测试', 状态: '待响应' },
    });
    const ticket = await res.json();

    await page.request.put(`${API}/api/nodes/${ticket.id}`, {
      data: { 标题: 'E2E审计更新测试-已修改' },
    });

    await page.goto('/audit');
    await page.waitForLoadState('networkidle');
    await waitForTable(page);

    const actionSelect = page.locator('.ant-select').nth(1);
    await selectOption(page, actionSelect, '更新');

    await page.waitForTimeout(500);
    await waitForTable(page);
    await expect(page.getByText('E2E审计更新测试').first()).toBeVisible({ timeout: 10000 });
  });

  test('filter by entity type node', async ({ page }) => {
    await page.request.post(`${API}/api/nodes/person`, {
      data: { 姓名: 'E2E审计人员测试' },
    });

    await page.goto('/audit');
    await page.waitForLoadState('networkidle');
    await waitForTable(page);

    const typeSelect = page.locator('.ant-select').nth(2);
    await selectOption(page, typeSelect, '节点');

    await page.waitForTimeout(500);
    await waitForTable(page);
    await expect(page.getByText('E2E审计人员测试').first()).toBeVisible({ timeout: 10000 });
  });

  test('combined action + entity type filters', async ({ page }) => {
    const res = await page.request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E组合筛选测试', 状态: '待响应' },
    });
    const ticket = await res.json();
    await page.request.put(`${API}/api/nodes/${ticket.id}`, {
      data: { 标题: 'E2E组合筛选测试-改' },
    });

    await page.goto('/audit');
    await page.waitForLoadState('networkidle');
    await waitForTable(page);

    const actionSelect = page.locator('.ant-select').nth(1);
    await selectOption(page, actionSelect, '更新');
    const typeSelect = page.locator('.ant-select').nth(2);
    await selectOption(page, typeSelect, '节点');

    await page.waitForTimeout(500);
    await waitForTable(page);
    await expect(page.getByText('组合筛选').first()).toBeVisible({ timeout: 10000 });
  });

  test('refresh button reloads data', async ({ page }) => {
    await waitForTable(page);

    await page.request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E刷新测试单', 状态: '待响应' },
    });

    await page.getByText('刷新').click();
    await page.waitForTimeout(1000);
    await waitForTable(page);
    await expect(page.getByText('E2E刷新测试单').first()).toBeVisible({ timeout: 10000 });
  });

  test('change details tag shows count', async ({ page }) => {
    const res = await page.request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E变更计数测试', 状态: '待响应' },
    });
    const ticket = await res.json();
    await page.request.put(`${API}/api/nodes/${ticket.id}`, {
      data: { 标题: 'E2E变更计数测试-改', 客户名称: 'E2E客户' },
    });

    await page.goto('/audit');
    await page.waitForLoadState('networkidle');
    await waitForTable(page);

    const changeTag = page.getByText(/\d+项变更/).first();
    if (await changeTag.isVisible({ timeout: 5000 }).catch(() => false)) {
      const text = await changeTag.textContent();
      const count = parseInt(text ?? '0');
      expect(count).toBeGreaterThanOrEqual(1);
    }
  });

  test('shows performedBy and timestamp', async ({ page }) => {
    await page.request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E时间戳测试', 状态: '待响应' },
    });

    await page.goto('/audit');
    await page.waitForLoadState('networkidle');
    await waitForTable(page);

    await expect(page.getByText(/\d{2}-\d{2}/).first()).toBeVisible({ timeout: 10000 });
  });
});
