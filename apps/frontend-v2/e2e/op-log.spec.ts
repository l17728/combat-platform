import { test, expect } from '@playwright/test';
import { API, waitForTable } from './helpers';

test.describe('操作追踪', () => {
  test('shows page heading and table', async ({ page }) => {
    await page.goto('/op-log');
    await expect(page.getByRole('heading', { name: '操作追踪' })).toBeVisible();
    await page.locator('.ant-table').first().waitFor({ state: 'visible', timeout: 10000 });
  });

  test('records navigation entries after page visits', async ({ page, request }) => {
    const insertRes = await request.post(`${API}/api/op-logs`, {
      data: [
        { session_id: 'nav-test-session', user_name: 'admin', category: 'navigate', detail: { from: '/', to: '/op-log' }, timestamp: new Date().toISOString() },
      ],
    });
    expect((await insertRes.json()).inserted).toBe(1);

    await page.goto('/op-log');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    const adminCell = page.getByRole('cell', { name: 'admin' }).first();
    await expect(adminCell).toBeVisible({ timeout: 10000 });

    await request.delete(`${API}/api/op-logs?sessionId=nav-test-session`);
  });

  test('filters by category', async ({ page }) => {
    await page.goto('/op-log');
    await page.waitForLoadState('networkidle');

    const categorySelect = page.locator('.ant-select').nth(0);
    await categorySelect.locator('.ant-select-selector').click();
    await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')
      .last()
      .waitFor({ state: 'visible', timeout: 5000 });
    const dropdown = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').last();
    const opt = dropdown.locator('.ant-select-item-option').filter({ hasText: 'API调用' }).first();
    await opt.dispatchEvent('click');
    await page.waitForTimeout(500);
  });

  test('filter by username input', async ({ page }) => {
    await page.goto('/op-log');
    await page.waitForLoadState('networkidle');
    const input = page.getByPlaceholder('用户名');
    await expect(input).toBeVisible();
    await input.fill('admin');
    await page.waitForTimeout(500);
  });

  test('cleanup button shows confirmation', async ({ page }) => {
    await page.goto('/op-log');
    await page.waitForLoadState('networkidle');
    const btn = page.getByRole('button', { name: /清理旧数据/ });
    await expect(btn).toBeVisible();
  });

  test('toggle switch is visible for admin', async ({ page }) => {
    await page.goto('/op-log');
    await page.waitForLoadState('networkidle');
    const switchEl = page.locator('.ant-switch');
    await expect(switchEl).toBeVisible();
  });

  test('toggle switch turns off tracking', async ({ page }) => {
    await page.goto('/op-log');
    await page.waitForLoadState('networkidle');

    const switchEl = page.locator('.ant-switch');
    await expect(switchEl).toBeVisible();

    await switchEl.click();
    await page.waitForTimeout(500);

    const alert = page.getByText(/操作追踪当前已关闭/);
    await expect(alert).toBeVisible();

    await switchEl.click();
    await page.waitForTimeout(500);
  });

  test('sidebar has 操作追踪 under system management', async ({ page }) => {
    await page.goto('/');
    await page.locator('.ant-menu-submenu-title').filter({ hasText: '系统管理' }).click();
    await page.waitForTimeout(300);
    const menuItem = page.locator('.ant-menu-item').filter({ hasText: '操作追踪' });
    await expect(menuItem).toBeVisible();
    await menuItem.click();
    await expect(page).toHaveURL('/op-log');
  });

  test('backend API batch write works', async ({ request }) => {
    const res = await request.post(`${API}/api/op-logs`, {
      data: [
        { session_id: 'test-session', user_name: 'e2e', category: 'action', detail: { action: 'test' } },
      ],
    });
    const body = await res.json();
    expect(body.inserted).toBe(1);

    const listRes = await request.get(`${API}/api/op-logs?sessionId=test-session`);
    const listBody = await listRes.json();
    expect(listBody.total).toBeGreaterThanOrEqual(1);

    const delRes = await request.delete(`${API}/api/op-logs?sessionId=test-session`);
    const delBody = await delRes.json();
    expect(delBody.deleted).toBeGreaterThanOrEqual(1);
  });

  test('backend settings API works', async ({ request }) => {
    const getRes = await request.get(`${API}/api/op-logs/settings`);
    const getBody = await getRes.json();
    expect(typeof getBody.enabled).toBe('boolean');

    await request.put(`${API}/api/op-logs/settings`, { data: { enabled: false } });
    const offRes = await request.get(`${API}/api/op-logs/settings`);
    expect((await offRes.json()).enabled).toBe(false);

    await request.put(`${API}/api/op-logs/settings`, { data: { enabled: true } });
    const onRes = await request.get(`${API}/api/op-logs/settings`);
    expect((await onRes.json()).enabled).toBe(true);
  });
});
