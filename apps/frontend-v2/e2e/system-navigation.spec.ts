import { test, expect } from '@playwright/test';

const API = 'http://localhost:3001';

test.describe('求助中心', () => {
  test('renders help center page', async ({ page }) => {
    await page.goto('/help');
    await expect(page.getByText('求助中心')).toBeVisible();
    await expect(page.getByText('发起求助')).toBeVisible();
  });
});

test.describe('系统管理 - 导入/导出', () => {
  test('renders import/export page', async ({ page }) => {
    await page.goto('/import');
    await expect(page.getByText('数据导入/导出')).toBeVisible();
  });
});

test.describe('系统管理 - 邮件设置', () => {
  test('renders email settings page', async ({ page }) => {
    await page.goto('/email');
    await expect(page.getByText('邮件设置')).toBeVisible();
    await expect(page.getByText('SMTP 服务器')).toBeVisible();
  });
});

test.describe('系统管理 - 审计日志', () => {
  test('renders audit log page', async ({ page }) => {
    await page.goto('/audit');
    await expect(page.getByText('审计日志')).toBeVisible();
  });

  test('shows audit entries after action', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E审计测试单', 状态: '待响应' },
    });

    await page.goto('/audit');
    await expect(page.getByText('create')).toBeVisible();
  });
});

test.describe('导航', () => {
  test('sidebar navigation works', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('作战态势')).toBeVisible();

    await page.getByText('攻关作战台').click();
    await expect(page.getByText('攻关作战台')).toBeVisible();

    await page.getByText('全员名单').click();
    await expect(page.getByText('全员名单')).toBeVisible();

    await page.getByText('荣誉殿堂').click();
    await expect(page.getByText('荣誉殿堂')).toBeVisible();

    await page.getByText('求助中心').click();
    await expect(page.getByText('求助中心')).toBeVisible();
  });

  test('role switcher is present', async ({ page }) => {
    await page.goto('/');
    const selector = page.locator('.ant-select').last();
    await expect(selector).toBeVisible();
  });

  test('sidebar collapse toggle works', async ({ page }) => {
    await page.goto('/');
    const toggle = page.getByText(/unfold|fold/i).locator('..');
    await page.locator('span').filter({ hasText: /fold/i }).first().click();
  });
});
