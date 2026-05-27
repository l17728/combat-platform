import { test, expect } from '@playwright/test';
import { API, waitForTable } from './helpers';

async function mockUnauthenticated(page: import('@playwright/test').Page) {
  await page.route('**/api/auth/me', route => {
    route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: '未登录' }) });
  });
}

async function clearAuthAndMock(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.removeItem('combat-token');
    localStorage.removeItem('combat-user');
    localStorage.removeItem('combat-role');
  });
  await mockUnauthenticated(page);
}

test.describe('认证流程 - 完整覆盖', () => {

  test('未认证访问受保护路由 → 重定向到 /login', async ({ page }) => {
    await clearAuthAndMock(page);
    await page.goto('/attack');
    await page.waitForURL('**/login', { timeout: 5000 });
    await expect(page).toHaveURL('/login');
    await expect(page.getByPlaceholder('用户名')).toBeVisible();
  });

  test('未认证访问 / → 重定向到 /login', async ({ page }) => {
    await clearAuthAndMock(page);
    await page.goto('/');
    await page.waitForURL('**/login', { timeout: 5000 });
    await expect(page).toHaveURL('/login');
  });

  test('未认证访问详情页 → 重定向到 /login', async ({ page, request }) => {
    const res = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: '认证测试单', 状态: '待响应' },
    });
    const ticket = await res.json();
    await clearAuthAndMock(page);
    await page.goto(`/attack/${ticket.id}`);
    await page.waitForURL('**/login', { timeout: 5000 });
    await expect(page).toHaveURL('/login');
  });

  test('登录页面表单验证 - 空用户名密码', async ({ page }) => {
    await clearAuthAndMock(page);
    await page.goto('/login');
    await page.waitForURL('**/login', { timeout: 5000 });
    await page.getByRole('button', { name: /登\s?录/ }).click();
    await expect(page.getByText('请输入用户名')).toBeVisible({ timeout: 5000 });
  });

  test('登录页面 - 错误密码显示错误提示', async ({ page }) => {
    await clearAuthAndMock(page);
    await page.goto('/login');
    await page.waitForURL('**/login', { timeout: 5000 });
    await page.getByPlaceholder('用户名').fill('admin');
    await page.getByPlaceholder('密码').fill('wrongpassword');
    await page.getByRole('button', { name: /登\s?录/ }).click();
    await expect(page.getByText(/用户名或密码错误|登录失败/)).toBeVisible({ timeout: 10000 });
    await expect(page).toHaveURL('/login');
  });

  test('登录成功 → 跳转到首页', async ({ page }) => {
    await clearAuthAndMock(page);
    await page.goto('/login');
    await page.waitForURL('**/login', { timeout: 5000 });
    await page.getByPlaceholder('用户名').fill('admin');
    await page.getByPlaceholder('密码').fill('admin123');
    await page.getByRole('button', { name: /登\s?录/ }).click();
    await expect(page.getByText(/登\s?录成功/)).toBeVisible({ timeout: 10000 });
    await page.waitForURL(/\/(attack|)$/, { timeout: 10000 });
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('登录成功 → token 和 user 存入 localStorage', async ({ page }) => {
    await clearAuthAndMock(page);
    await page.goto('/login');
    await page.waitForURL('**/login', { timeout: 5000 });
    await page.getByPlaceholder('用户名').fill('admin');
    await page.getByPlaceholder('密码').fill('admin123');
    await page.getByRole('button', { name: /登\s?录/ }).click();
    await page.waitForURL(/\/(attack|)$/, { timeout: 10000 });
    const token = await page.evaluate(() => localStorage.getItem('combat-token'));
    const user = await page.evaluate(() => localStorage.getItem('combat-user'));
    expect(token).toBeTruthy();
    expect(user).toBeTruthy();
    const parsed = JSON.parse(user!);
    expect(parsed.username).toBe('admin');
    expect(parsed.role).toBe('admin');
  });

  test('已登录状态访问 /login → 自动跳转到首页', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '作战态势' })).toBeVisible({ timeout: 5000 });
    await page.goto('/login');
    await page.waitForURL(/\/(attack|)$/, { timeout: 5000 });
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('登出 → 清除 localStorage 并跳转到 /login', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '作战态势' })).toBeVisible({ timeout: 5000 });

    const userDropdown = page.locator('.ant-dropdown-trigger').last();
    await userDropdown.click();
    await page.getByText('退出登录').click();
    await page.waitForURL('**/login', { timeout: 5000 });
    await expect(page).toHaveURL('/login');

    const tokenAfter = await page.evaluate(() => localStorage.getItem('combat-token'));
    expect(tokenAfter).toBeNull();
    const userAfter = await page.evaluate(() => localStorage.getItem('combat-user'));
    expect(userAfter).toBeNull();
  });

  test('登出后再次访问受保护路由 → 重定向到 /login', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '作战态势' })).toBeVisible({ timeout: 5000 });
    const userDropdown = page.locator('.ant-dropdown-trigger').last();
    await userDropdown.click();
    await page.getByText('退出登录').click();
    await page.waitForURL('**/login', { timeout: 5000 });

    await mockUnauthenticated(page);
    await page.goto('/attack');
    await page.waitForURL('**/login', { timeout: 5000 });
    await expect(page).toHaveURL('/login');
  });

  test('登录页面 UI 元素完整', async ({ page }) => {
    await clearAuthAndMock(page);
    await page.goto('/login');
    await page.waitForURL('**/login', { timeout: 5000 });
    await expect(page.getByText('作战平台')).toBeVisible();
    await expect(page.getByText('请登录以继续')).toBeVisible();
    await expect(page.getByPlaceholder('用户名')).toBeVisible();
    await expect(page.getByPlaceholder('密码')).toBeVisible();
    await expect(page.getByRole('button', { name: /登\s?录/ })).toBeVisible();
    await expect(page.getByText(/admin.*admin123/)).toBeVisible();
  });

  test('登录 → 使用系统 → 登出 → 再登录 完整流程', async ({ page }) => {
    await clearAuthAndMock(page);
    await page.goto('/login');
    await page.waitForURL('**/login', { timeout: 5000 });
    await page.getByPlaceholder('用户名').fill('admin');
    await page.getByPlaceholder('密码').fill('admin123');
    await page.getByRole('button', { name: /登\s?录/ }).click();
    await page.waitForURL(/\/(attack|)$/, { timeout: 10000 });
    await expect(page.getByRole('heading', { name: '作战态势' })).toBeVisible({ timeout: 5000 });

    await page.unroute('**/api/auth/me');
    await page.goto('/attack');
    await waitForTable(page);

    const userDropdown = page.locator('.ant-dropdown-trigger').last();
    await userDropdown.click();
    await page.getByText('退出登录').click();
    await page.waitForURL('**/login', { timeout: 5000 });
    await mockUnauthenticated(page);

    await page.getByPlaceholder('用户名').fill('admin');
    await page.getByPlaceholder('密码').fill('admin123');
    await page.getByRole('button', { name: /登\s?录/ }).click();
    await page.waitForURL(/\/(attack|)$/, { timeout: 10000 });
    await expect(page.getByRole('heading', { name: '作战态势' })).toBeVisible({ timeout: 5000 });
  });
});

test.describe('角色权限 UI 验证', () => {
  test('header 显示用户名和角色', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '作战态势' })).toBeVisible({ timeout: 5000 });
    const userDropdown = page.locator('.ant-dropdown-trigger').last();
    await expect(userDropdown).toContainText('系统管理员');
  });

  test('admin 用户下拉菜单有用户管理入口', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '作战态势' })).toBeVisible({ timeout: 5000 });
    const userDropdown = page.locator('.ant-dropdown-trigger').last();
    await userDropdown.click();
    await expect(page.getByText('用户管理')).toBeVisible();
  });

  test('登录页面不显示侧边栏', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.removeItem('combat-token');
      localStorage.removeItem('combat-user');
      localStorage.removeItem('combat-role');
    });
    await mockUnauthenticated(page);
    await page.goto('/login');
    await page.waitForURL('**/login', { timeout: 5000 });
    await expect(page.locator('.ant-layout-sider')).not.toBeVisible();
  });
});
