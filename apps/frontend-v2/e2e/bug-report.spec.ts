import { test, expect } from '@playwright/test';
import { API, opsCell, selectOption, waitForDrawer, waitForTable } from './helpers';

test.describe('问题反馈', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/bug-report');
    await page.waitForLoadState('networkidle');
  });

  test('shows page heading and create button', async ({ page }) => {
    await expect(page.getByRole('heading', { name: '问题反馈' })).toBeVisible();
    await expect(page.getByRole('button', { name: '提交问题' })).toBeVisible();
  });

  test('shows status filter select', async ({ page }) => {
    const statusSelect = page.locator('.ant-select').nth(0);
    await expect(statusSelect).toBeVisible();
  });

  test('create bug report via drawer', async ({ page }) => {
    await page.getByRole('button', { name: '提交问题' }).click();
    await waitForDrawer(page);

    const drawer = page.locator('.ant-drawer');
    await drawer.getByPlaceholder('简要描述发现的问题').fill('E2E测试问题标题');
    await drawer.getByPlaceholder('详细描述问题现象、复现步骤、预期行为等').fill('E2E测试问题描述');

    await page.locator('.ant-drawer-extra button').click();

    await expect(page.getByText('问题已提交').first()).toBeVisible();
  });

  test('create requires title', async ({ page }) => {
    await page.getByRole('button', { name: '提交问题' }).click();
    await waitForDrawer(page);

    await page.locator('.ant-drawer-extra button').click();

    await expect(page.getByText('请输入问题标题')).toBeVisible();
  });

  test('drawer close discards data', async ({ page }) => {
    await page.getByRole('button', { name: '提交问题' }).click();
    await waitForDrawer(page);

    await page.locator('.ant-drawer').getByPlaceholder('简要描述发现的问题').fill('E2E不应存在的标题');
    await page.locator('.ant-drawer-close').click();

    await expect(page.getByText('E2E不应存在的标题')).not.toBeVisible();
  });

  test('bug report lifecycle via detail drawer', async ({ page }) => {
    const res = await page.request.post(`${API}/api/bug-reports`, {
      headers: { 'Content-Type': 'application/json' },
      data: { title: 'E2E生命周期问题', severity: '较高', description: '测试生命周期' },
    });
    const bug = await res.json();

    await page.goto('/bug-report');
    await waitForTable(page);
    await expect(page.getByText('E2E生命周期问题')).toBeVisible();

    await page.getByText('E2E生命周期问题').click();
    await waitForDrawer(page);
    const drawer = page.locator('.ant-drawer');

    await drawer.getByRole('button', { name: '开始处理' }).click();
    await expect(page.getByText('状态已更新').first()).toBeVisible();
    await page.waitForTimeout(500);

    await page.goto('/bug-report');
    await waitForTable(page);
    const statusSelect = page.locator('.ant-select').nth(0);
    await selectOption(page, statusSelect, '处理中');
    await waitForTable(page);
    await page.getByText('E2E生命周期问题').click();
    await waitForDrawer(page);
    const drawer2 = page.locator('.ant-drawer');
    await drawer2.getByRole('button', { name: '标记已解决' }).click();
    await expect(page.getByText('状态已更新').first()).toBeVisible();
    await page.waitForTimeout(500);

    await page.goto('/bug-report');
    await waitForTable(page);
    await selectOption(page, statusSelect, '已解决');
    await waitForTable(page);
    await page.getByText('E2E生命周期问题').click();
    await waitForDrawer(page);
    const drawer3 = page.locator('.ant-drawer');
    await drawer3.getByRole('button', { name: '关闭问题' }).click();
    await expect(page.getByText('状态已更新').first()).toBeVisible();
  });

  test('view bug report detail drawer', async ({ page }) => {
    await page.request.post(`${API}/api/bug-reports`, {
      headers: { 'Content-Type': 'application/json' },
      data: { title: 'E2E详情测试问题', severity: '严重', description: '测试详情查看' },
    });

    await page.goto('/bug-report');
    await waitForTable(page);

    await page.getByText('E2E详情测试问题').click();
    await waitForDrawer(page);

    const drawer = page.locator('.ant-drawer');
    await expect(drawer.getByText('E2E详情测试问题')).toBeVisible();
    await expect(drawer.locator('.ant-tag').filter({ hasText: '严重' })).toBeVisible();
    await expect(drawer.getByText('测试详情查看')).toBeVisible();
  });

  test('delete bug report', async ({ page }) => {
    await page.request.post(`${API}/api/bug-reports`, {
      headers: { 'Content-Type': 'application/json' },
      data: { title: 'E2E待移除问题', severity: '一般' },
    });

    await page.goto('/bug-report');
    await waitForTable(page);

    await expect(page.getByText('E2E待移除问题')).toBeVisible();

    const row = page.getByRole('row').filter({ hasText: 'E2E待移除问题' });
    await opsCell(row).locator('a').filter({ hasText: /删\s?除/ }).click();
    await page.waitForTimeout(300);
    await page.locator('.ant-popconfirm').getByRole('button', { name: /确\s?定|OK/ }).click();
    await page.waitForTimeout(1000);

    await expect(page.getByText('已删除').first()).toBeVisible();
    await expect(page.getByText('E2E待移除问题')).not.toBeVisible();
  });

  test('filter by status', async ({ page }) => {
    await page.request.post(`${API}/api/bug-reports`, {
      headers: { 'Content-Type': 'application/json' },
      data: { title: 'E2E筛选测试问题', severity: '建议' },
    });

    await page.goto('/bug-report');
    await waitForTable(page);

    await expect(page.getByText('E2E筛选测试问题')).toBeVisible();
  });

  test('severity select in create drawer has correct options', async ({ page }) => {
    await page.getByRole('button', { name: '提交问题' }).click();
    await waitForDrawer(page);

    const drawer = page.locator('.ant-drawer');
    const severitySelect = drawer.locator('.ant-select').first();
    await severitySelect.locator('.ant-select-selector').click();
    await page.waitForTimeout(300);

    const dropdown = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').last();
    await expect(dropdown.locator('.ant-select-item-option').filter({ hasText: '严重' }).first()).toBeVisible();
    await expect(dropdown.locator('.ant-select-item-option').filter({ hasText: '较高' }).first()).toBeVisible();
    await expect(dropdown.locator('.ant-select-item-option').filter({ hasText: '一般' }).first()).toBeVisible();
    await expect(dropdown.locator('.ant-select-item-option').filter({ hasText: '建议' }).first()).toBeVisible();
  });
});
