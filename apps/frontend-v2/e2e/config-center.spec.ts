import { test, expect } from '@playwright/test';
import { API } from './helpers';

test.describe('配置中心', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/config');
    await page.waitForLoadState('networkidle');
  });

  test('shows page heading and buttons', async ({ page }) => {
    await expect(page.getByRole('heading', { name: '配置中心' })).toBeVisible();
    await expect(page.getByText(/刷\s?新/)).toBeVisible();
    await expect(page.getByRole('button', { name: /新增配置/ }).first()).toBeVisible();
  });

  test('search input filters config items', async ({ page }) => {
    const searchInput = page.getByPlaceholder('搜索配置键名');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('nonexistent_xyz');
    await page.waitForTimeout(300);
    const rows = page.locator('.ant-table-row');
    expect(await rows.count()).toBe(0);
    await searchInput.fill('');
    await page.waitForTimeout(300);
  });

  test('refresh button reloads data', async ({ page }) => {
    await page.getByText(/刷\s?新/).click();
    await page.waitForTimeout(500);
    await expect(page.locator('.ant-table').or(page.getByText('暂无配置项'))).toBeVisible();
  });

  test('add new config item via modal', async ({ page }) => {
    await page.getByRole('button', { name: /新增配置/ }).first().click();
    await page.waitForTimeout(500);

    await page.getByPlaceholder('例: 状态、事件级别、贡献类型').fill('测试配置项E2E');
    await page.getByPlaceholder('例: 攻关单状态').fill('测试显示名');
    await page.getByPlaceholder('待响应, 处理中, 进行中, 已解决, 已关闭').fill('选项A, 选项B, 选项C');

    await page.locator('.ant-modal').getByRole('button', { name: /保\s?存/ }).click();
    await page.waitForTimeout(1000);

    await expect(page.getByText('测试配置项E2E')).toBeVisible();
    await expect(page.getByText('选项A')).toBeVisible();
  });

  test('add modal cancel does not create data', async ({ page }) => {
    await page.waitForTimeout(1000);
    const beforeRows = await page.locator('.ant-table-row').count();

    await page.getByRole('button', { name: /新增配置/ }).first().click();
    await page.waitForTimeout(500);
    await page.getByPlaceholder('例: 状态、事件级别、贡献类型').fill('ShouldNotPersist');
    await page.locator('.ant-modal').getByRole('button', { name: /取\s?消/ }).click();
    await page.waitForTimeout(500);

    const afterRows = await page.locator('.ant-table-row').count();
    expect(afterRows).toBe(beforeRows);
  });

  test('edit config item via modal', async ({ page }) => {
    await page.request.put(`${API}/api/settings/e2eTestConfig`, {
      headers: { 'Content-Type': 'application/json' },
      data: { values: ['值1', '值2'], label: '测试标签' },
    });
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Target THIS test's own config row — never the blind first row, which under
    // full-suite accumulation is config:状态 (seeded from alarmGovernance) and
    // whose corruption would break every later attackTicket 状态流转 test.
    await page.getByPlaceholder('搜索配置键名').fill('e2eTestConfig');
    await page.waitForTimeout(300);
    const row = page.locator('.ant-table-row').filter({ hasText: 'e2eTestConfig' });
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.getByText(/编\s?辑/).click();
    await page.waitForTimeout(500);

    const modal = page.locator('.ant-modal');
    await expect(modal).toBeVisible();

    const valuesTextarea = modal.locator('textarea');
    await valuesTextarea.clear();
    await valuesTextarea.fill('新值A, 新值B, 新值C');

    await modal.getByRole('button', { name: /保\s?存/ }).click();
    await page.waitForTimeout(1000);

    await expect(page.getByText('新值A')).toBeVisible();
  });

  test('delete config item via modal', async ({ page }) => {
    await page.request.put(`${API}/api/settings/e2eDeleteTest`, {
      headers: { 'Content-Type': 'application/json' },
      data: { values: ['x'] },
    });
    await page.reload();
    await page.waitForLoadState('networkidle');

    const row = page.locator('.ant-table-row').filter({ hasText: 'e2eDeleteTest' });
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.getByText(/删\s?除/).click();

    const modal = page.locator('.ant-modal').filter({ hasText: '确认删除配置项' });
    await expect(modal).toBeVisible();
    await modal.getByRole('button', { name: '确认删除' }).click();

    await expect(page.getByText('配置已删除').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('cell', { name: 'e2eDeleteTest' })).not.toBeVisible();
  });

  test('search clear button resets filter', async ({ page }) => {
    await page.request.put(`${API}/api/settings/e2eSearchTest',`, {
      headers: { 'Content-Type': 'application/json' },
      data: { values: ['a'] },
    });
    await page.reload();
    await page.waitForLoadState('networkidle');

    const searchInput = page.getByPlaceholder('搜索配置键名');
    await searchInput.fill('e2eSearchTest');
    await page.waitForTimeout(300);

    await searchInput.clear();
    await page.waitForTimeout(300);
    await expect(searchInput).toHaveValue('');
  });
});
