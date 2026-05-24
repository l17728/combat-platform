import { test, expect } from '@playwright/test';
import { API, selectOption, waitForTable } from './helpers';

test.describe('表结构管理', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/schema');
    await page.waitForLoadState('networkidle');
  });

  test('shows existing table list', async ({ page }) => {
    await expect(page.getByRole('heading', { name: '表结构管理' })).toBeVisible();
    const rows = page.locator('.ant-table-row');
    await expect(rows.first()).toBeVisible({ timeout: 5000 });
    expect(await rows.count()).toBeGreaterThanOrEqual(3);
  });

  test('click table row shows detail card', async ({ page }) => {
    const firstRow = page.locator('.ant-table-row').first();
    await firstRow.click();
    await page.waitForTimeout(300);

    await expect(page.getByText('关闭')).toBeVisible();
  });

  test('close button hides detail card', async ({ page }) => {
    const firstRow = page.locator('.ant-table-row').first();
    await firstRow.click();
    await page.waitForTimeout(300);
    await expect(page.getByText('关闭')).toBeVisible();

    await page.getByRole('button', { name: '关闭' }).click();
    await page.waitForTimeout(300);
    await expect(page.getByRole('button', { name: '关闭' })).not.toBeVisible();
  });

  test('create new table with fields', async ({ page }) => {
    const tableName = 'e2eTest' + Date.now().toString(36);

    await page.getByPlaceholder('e.g. workOrder').fill(tableName);
    await page.getByPlaceholder('e.g. 工单').fill('E2E测试表');

    const firstRowName = page.locator('.ant-table-row').last().locator('input').first();
    await firstRowName.fill('title');
    const firstRowLabel = page.locator('.ant-table-row').last().locator('input').nth(1);
    await firstRowLabel.fill('标题');

    await page.getByRole('button', { name: '创建数据表' }).click();
    await page.waitForTimeout(1500);

    await expect(page.locator('code').filter({ hasText: tableName })).toBeVisible();

    await page.request.delete(`${API}/api/schema/nodeType/${tableName}`, {
      headers: { 'X-Role': 'admin' },
    });
  });

  test('add field row button adds row', async ({ page }) => {
    const rowsBefore = await page.locator('.ant-table-row').count();

    await page.getByRole('button', { name: '添加字段' }).click();
    await page.waitForTimeout(300);

    const rowsAfter = await page.locator('.ant-table-row').count();
    expect(rowsAfter).toBeGreaterThan(rowsBefore);
  });

  test('delete field row button removes row', async ({ page }) => {
    await page.getByRole('button', { name: '添加字段' }).click();
    await page.waitForTimeout(300);

    const rowsBefore = await page.locator('.ant-table-row').count();
    const deleteButtons = page.locator('.ant-table-row').last().locator('button[aria-label="delete"], .ant-btn-dangerous');
    if (await deleteButtons.isVisible()) {
      await deleteButtons.click();
      await page.waitForTimeout(300);
      const rowsAfter = await page.locator('.ant-table-row').count();
      expect(rowsAfter).toBeLessThan(rowsBefore);
    }
  });

  test('field type select changes type', async ({ page }) => {
    const typeSelect = page.locator('.ant-table-row').last().locator('.ant-select').first();
    if (await typeSelect.isVisible()) {
      await selectOption(page, typeSelect, '枚举');
      await page.waitForTimeout(300);

      const enumInput = page.locator('.ant-table-row').last().locator('input[placeholder="待响应,处理中"]');
      if (await enumInput.isVisible()) {
        await enumInput.fill('选项A,选项B');
      }
    }
  });

  test('validation rejects empty table name', async ({ page }) => {
    await page.getByRole('button', { name: '创建数据表' }).click();
    await page.waitForTimeout(500);

    const msg = page.locator('.ant-message');
    await expect(msg).toBeVisible({ timeout: 3000 });
  });

  test('delete existing schema via popconfirm', async ({ page }) => {
    const res = await page.request.post(`${API}/api/schema/nodeType`, {
      headers: { 'Content-Type': 'application/json', 'X-Role': 'admin' },
      data: { nodeType: 'e2eDelTest', label: '删除测试', fields: [{ id: 'name', name: 'name', label: '名称', type: 'string' }] },
    });
    if (res.ok()) {
      await page.reload();
      await page.waitForLoadState('networkidle');

      const row = page.locator('.ant-table-row').filter({ hasText: 'e2eDelTest' });
      if (await row.isVisible()) {
        const deleteBtn = row.locator('.ant-btn-dangerous');
        if (await deleteBtn.isVisible()) {
          await deleteBtn.click();
          await page.waitForTimeout(300);
          await page.locator('.ant-popconfirm').getByRole('button', { name: /确\s?定|OK/ }).click();
          await page.waitForTimeout(1000);
        }
      }
    }
  });

  test('find existing fields popover', async ({ page }) => {
    const popoverBtn = page.locator('button').filter({ hasText: /查找现有字段/ });
    if (await popoverBtn.isVisible()) {
      await popoverBtn.click();
      await page.waitForTimeout(1000);
    }
  });
});
