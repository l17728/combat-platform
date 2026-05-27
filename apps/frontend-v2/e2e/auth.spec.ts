import { test, expect } from '@playwright/test';
import { API, waitForTable } from './helpers';

test.describe('认证系统（旧测试，保留兼容）', () => {
  test('login page redirects to dashboard when already authenticated', async ({ page }) => {
    await page.goto('/login');
    await page.waitForURL(/\/(attack|)$/, { timeout: 5000 });
    await expect(page).not.toHaveURL(/\/login/);
  });
});

test.describe('用户管理', () => {
  test('shows user management page with admin user', async ({ page }) => {
    await page.goto('/users');
    await expect(page.getByRole('heading', { name: '用户管理' })).toBeVisible();
    await waitForTable(page);
    await expect(page.getByText('admin').first()).toBeVisible();
  });

  test('create new user via modal', async ({ page }) => {
    await page.goto('/users');
    await waitForTable(page);
    const rowCount = await page.locator('.ant-table-row').count();

    await page.getByRole('button', { name: '新建用户' }).click();
    const modal = page.locator('.ant-modal').filter({ hasText: '新建用户' });
    await expect(modal).toBeVisible();
    await modal.getByPlaceholder('2-32个字符').fill('e2etestuser');
    await modal.getByPlaceholder('至少6个字符').fill('test123456');
    await modal.getByRole('button', { name: /创\s?建/ }).click();

    await expect(page.getByText('用户已创建')).toBeVisible();
    await expect(page.locator('.ant-table-row')).toHaveCount(rowCount + 1);
  });

  test('delete user via popconfirm', async ({ page, request }) => {
    await request.post(`${API}/api/users`, {
      data: { username: 'e2eDeleteUser', password: 'test123456', role: 'normal' },
    });

    await page.goto('/users');
    await waitForTable(page);
    const row = page.getByRole('row').filter({ hasText: 'e2eDeleteUser' });
    await row.getByText('删除').click();
    await page.getByRole('button', { name: /确\s?定/ }).click();

    await expect(page.getByText('用户已删除')).toBeVisible();
  });

  test('modal cancel does not create user', async ({ page }) => {
    await page.goto('/users');
    await waitForTable(page);
    const rowCount = await page.locator('.ant-table-row').count();

    await page.getByRole('button', { name: '新建用户' }).click();
    const modal = page.locator('.ant-modal').filter({ hasText: '新建用户' });
    await modal.getByPlaceholder('2-32个字符').fill('e2ecanceluser');
    await modal.getByPlaceholder('至少6个字符').fill('test123456');
    await modal.getByRole('button', { name: /取\s?消/ }).click();

    await waitForTable(page);
    await expect(page.locator('.ant-table-row')).toHaveCount(rowCount);
  });
});
