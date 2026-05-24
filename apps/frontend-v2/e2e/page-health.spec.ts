import { test, expect } from '@playwright/test';

test.describe('回归防护 - 页面健康检查', () => {
  test('schema page loads without error (schema/list route conflict regression)', async ({ page }) => {
    const errors: string[] = [];
    page.on('response', resp => {
      if (resp.status() >= 400 && resp.url().includes('/api/')) {
        errors.push(`${resp.status()} ${resp.url()}`);
      }
    });
    await page.goto('/schema');
    await expect(page.getByRole('heading', { name: '表结构管理' })).toBeVisible();
    await page.waitForTimeout(1000);
    expect(errors).toEqual([]);
  });

  test('every page loads without API errors', async ({ page }) => {
    const apiErrors: string[] = [];
    page.on('response', resp => {
      if (resp.status() >= 400 && resp.url().includes('/api/')) {
        apiErrors.push(`${resp.status()} ${resp.url()}`);
      }
    });

    const pages = [
      '/attack',
      '/people',
      '/contributions',
      '/honor',
      '/help',
      '/daily-report',
      '/search',
      '/proposals',
      '/reminders',
      '/import',
      '/email',
      '/audit',
      '/schema',
      '/merge',
      '/config',
    ];

    for (const path of pages) {
      await page.goto(path);
      await page.waitForTimeout(500);
    }

    expect(apiErrors).toEqual([]);
  });

  test('schema page shows existing table list', async ({ page }) => {
    await page.goto('/schema');
    await expect(page.getByRole('heading', { name: '表结构管理' })).toBeVisible();
    await page.waitForTimeout(1000);
    const tableRows = page.locator('.ant-table-row');
    await expect(tableRows.first()).toBeVisible({ timeout: 5000 });
    expect(await tableRows.count()).toBeGreaterThanOrEqual(3);
  });
});
