import { test, expect } from '@playwright/test';

const API = 'http://localhost:3001';

test.describe('作战态势 Dashboard', () => {
  test('renders dashboard with stats cards', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('作战态势')).toBeVisible();
    await expect(page.getByText('进行中')).toBeVisible();
    await expect(page.getByText('总攻关单')).toBeVisible();
  });

  test('empty state shows when no data', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('暂无攻关记录')).toBeVisible();
  });
});
