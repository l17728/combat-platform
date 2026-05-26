import { test, expect } from '@playwright/test';
import { API, opsCell, waitForTable } from './helpers';

async function clearBugStatusFilter(page: import('@playwright/test').Page) {
  const statusSelect = page.locator('.ant-select').nth(0);
  const clearIcon = statusSelect.locator('.ant-select-clear');
  if (await clearIcon.isVisible({ timeout: 2000 })) {
    await clearIcon.click();
    await page.waitForTimeout(500);
    await waitForTable(page);
  }
}

test.describe('问题反馈 - 表格行操作', () => {
  test('开始处理 from table row transitions to 处理中', async ({ page }) => {
    await page.request.post(`${API}/api/bug-reports`, {
      data: { title: 'E2E行操作开始处理', severity: '一般', description: '测试行操作' },
    });

    await page.goto('/bug-report');
    await waitForTable(page);
    await expect(page.getByText('E2E行操作开始处理')).toBeVisible();

    const row = page.getByRole('row').filter({ hasText: 'E2E行操作开始处理' });
    await opsCell(row).locator('a').filter({ hasText: /开始处理/ }).click();
    await expect(page.getByText('状态已更新').first()).toBeVisible({ timeout: 5000 });

    await clearBugStatusFilter(page);
    await page.waitForTimeout(500);
    const updatedRow = page.getByRole('row').filter({ hasText: 'E2E行操作开始处理' });
    await expect(updatedRow.locator('td').nth(2).getByText(/处理中/)).toBeVisible();
  });

  test('已解决 from table row transitions to 已解决', async ({ page }) => {
    const res = await page.request.post(`${API}/api/bug-reports`, {
      data: { title: 'E2E行操作已解决', severity: '较高', description: '测试行操作' },
    });
    const bug = await res.json();
    await page.request.patch(`${API}/api/bug-reports/${bug.id}`, {
      data: { status: '处理中' },
    });

    await page.goto('/bug-report');
    await waitForTable(page);
    await clearBugStatusFilter(page);
    await expect(page.getByText('E2E行操作已解决')).toBeVisible();

    const row = page.getByRole('row').filter({ hasText: 'E2E行操作已解决' });
    await opsCell(row).locator('a').filter({ hasText: /已\s?解决/ }).click();
    await expect(page.getByText('状态已更新').first()).toBeVisible({ timeout: 5000 });

    await page.waitForTimeout(500);
    const updatedRow = page.getByRole('row').filter({ hasText: 'E2E行操作已解决' });
    await expect(updatedRow.locator('td').nth(2).getByText(/已解决/)).toBeVisible();
  });

  test('关闭 from table row transitions to 已关闭', async ({ page }) => {
    const res = await page.request.post(`${API}/api/bug-reports`, {
      data: { title: 'E2E行操作关闭', severity: '严重', description: '测试行操作' },
    });
    const bug = await res.json();
    await page.request.patch(`${API}/api/bug-reports/${bug.id}`, {
      data: { status: '已解决' },
    });

    await page.goto('/bug-report');
    await waitForTable(page);
    await clearBugStatusFilter(page);
    await expect(page.getByText('E2E行操作关闭')).toBeVisible();

    const row = page.getByRole('row').filter({ hasText: 'E2E行操作关闭' });
    await opsCell(row).locator('a').filter({ hasText: /关\s?闭/ }).click();
    await expect(page.getByText('状态已更新').first()).toBeVisible({ timeout: 5000 });

    await page.waitForTimeout(500);
    const updatedRow = page.getByRole('row').filter({ hasText: 'E2E行操作关闭' });
    await expect(updatedRow.locator('td').nth(2).getByText(/已关闭/)).toBeVisible();
  });

  test('full lifecycle via table row actions', async ({ page }) => {
    await page.request.post(`${API}/api/bug-reports`, {
      data: { title: 'E2E行生命周期', severity: '一般', description: '测试完整生命周期' },
    });

    await page.goto('/bug-report');
    await waitForTable(page);

    let row = page.getByRole('row').filter({ hasText: 'E2E行生命周期' });
    await opsCell(row).locator('a').filter({ hasText: /开始处理/ }).click();
    await expect(page.getByText('状态已更新').first()).toBeVisible({ timeout: 5000 });

    await clearBugStatusFilter(page);
    await page.waitForTimeout(500);
    row = page.getByRole('row').filter({ hasText: 'E2E行生命周期' });
    await opsCell(row).locator('a').filter({ hasText: /已\s?解决/ }).click();
    await expect(page.getByText('状态已更新').first()).toBeVisible({ timeout: 5000 });

    await page.waitForTimeout(500);
    row = page.getByRole('row').filter({ hasText: 'E2E行生命周期' });
    await opsCell(row).locator('a').filter({ hasText: /关\s?闭/ }).click();
    await expect(page.getByText('状态已更新').first()).toBeVisible({ timeout: 5000 });

    await page.waitForTimeout(500);
    row = page.getByRole('row').filter({ hasText: 'E2E行生命周期' });
    await expect(row.locator('td').nth(2).getByText(/已关闭/)).toBeVisible();
  });
});
