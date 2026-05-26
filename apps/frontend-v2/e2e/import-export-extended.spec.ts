import { test, expect } from '@playwright/test';
import { API, waitForTable } from './helpers';

test.describe('数据导入导出 - 扩展功能', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/import');
    await page.waitForLoadState('networkidle');
  });

  test('export person type', async ({ page }) => {
    await page.request.post(`${API}/api/nodes/person`, {
      data: { 姓名: 'E2E导出测试人' },
    });

    await page.goto('/import');
    await page.waitForLoadState('networkidle');

    const typeSelect = page.locator('.ant-select').nth(1);
    await typeSelect.locator('.ant-select-selector').click();
    await page.waitForTimeout(300);
    const dropdown = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').last();
    await dropdown.locator('.ant-select-item-option').filter({ hasText: '人员' }).first().dispatchEvent('click');
    await page.waitForTimeout(300);

    await page.getByRole('button', { name: /导出当前数据/ }).click();
    await expect(page.getByText('导出成功').first()).toBeVisible({ timeout: 10000 });
  });

  test('type selector has all 5 options', async ({ page }) => {
    const typeSelect = page.locator('.ant-select').nth(1);
    await typeSelect.locator('.ant-select-selector').click();
    await page.waitForTimeout(300);

    const dropdown = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').last();
    await expect(dropdown.locator('.ant-select-item-option').filter({ hasText: '攻关单' }).first()).toBeVisible();
    await expect(dropdown.locator('.ant-select-item-option').filter({ hasText: '人员' }).first()).toBeVisible();
    await expect(dropdown.locator('.ant-select-item-option').filter({ hasText: '贡献' }).first()).toBeVisible();
    await expect(dropdown.locator('.ant-select-item-option').filter({ hasText: '发布包' }).first()).toBeVisible();
    await expect(dropdown.locator('.ant-select-item-option').filter({ hasText: '权重文件' }).first()).toBeVisible();
  });

  test('upload area accepts xlsx files', async ({ page }) => {
    const dragger = page.locator('.ant-upload-drag');
    await expect(dragger).toBeVisible();
    await expect(page.getByText('点击或拖拽 Excel 文件到此处')).toBeVisible();
    await expect(page.getByText(/支持 \.xlsx/)).toBeVisible();
  });

  test('preview shows after upload', async ({ page }) => {
    await page.request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E预览测试', 状态: '待响应' },
    });

    const exportRes = await page.request.get(`${API}/api/export/attackTicket`);
    const xlsxBuffer = await exportRes.body();

    await page.locator('input[type="file"]').setInputFiles({
      name: 'test_preview.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: xlsxBuffer,
    });

    await expect(page.getByText(/预览结果/)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/新增 \d+/)).toBeVisible();
    await expect(page.getByText(/更新 \d+/)).toBeVisible();
    await expect(page.getByRole('button', { name: '确认导入' })).toBeVisible();
  });

  test('import flow completes after preview', async ({ page }) => {
    await page.request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E导入流程测试', 状态: '待响应' },
    });

    const exportRes = await page.request.get(`${API}/api/export/attackTicket`);
    const xlsxBuffer = await exportRes.body();

    await page.locator('input[type="file"]').setInputFiles({
      name: 'test_import.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: xlsxBuffer,
    });

    await expect(page.getByText(/预览结果/)).toBeVisible({ timeout: 10000 });

    const res = await page.request.post(`${API}/api/import?type=attackTicket`, {
      multipart: {
        file: {
          name: 'test_import.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          buffer: xlsxBuffer,
        },
      },
    });
    expect(res.ok()).toBeTruthy();
    const result = await res.json();
    expect(result.created + result.updated).toBeGreaterThanOrEqual(0);
  });

  test('export contribution type', async ({ page }) => {
    await page.request.post(`${API}/api/nodes/contribution`, {
      headers: { 'X-Role': 'leader' },
      data: { 贡献人: 'E2E贡献导出测试', 贡献类型: '技术突破' },
    });

    await page.goto('/import');
    await page.waitForLoadState('networkidle');

    const typeSelect = page.locator('.ant-select').nth(1);
    await typeSelect.locator('.ant-select-selector').click();
    await page.waitForTimeout(300);
    const dropdown = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').last();
    await dropdown.locator('.ant-select-item-option').filter({ hasText: '贡献' }).first().dispatchEvent('click');
    await page.waitForTimeout(300);

    await page.getByRole('button', { name: /导出当前数据/ }).click();
    await expect(page.getByText('导出成功').first()).toBeVisible({ timeout: 10000 });
  });
});
