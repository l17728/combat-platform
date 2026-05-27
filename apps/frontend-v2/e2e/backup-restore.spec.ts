import { test, expect } from '@playwright/test';
import { selectOption } from './helpers.js';

const BASE = process.env.E2E_API_URL || 'http://localhost:3201';

test.describe('数据库备份恢复', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/backup');
    await page.waitForSelector('.ant-card', { timeout: 10000 });
  });

  test('页面渲染正确', async ({ page }) => {
    await expect(page.getByText('数据库备份与恢复')).toBeVisible();
    await expect(page.getByText('定时备份设置')).toBeVisible();
    await expect(page.getByText('备份列表')).toBeVisible();
    await expect(page.getByRole('button', { name: /立即备份/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /恢复数据库/ })).toBeVisible();
  });

  test('立即备份创建成功', async ({ page }) => {
    await page.getByRole('button', { name: /立即备份/ }).click();
    await expect(page.getByText('备份已创建')).toBeVisible({ timeout: 10000 });
    await page.waitForSelector('tr.ant-table-row', { timeout: 5000 });
    const rows = page.locator('tr.ant-table-row');
    expect(await rows.count()).toBeGreaterThanOrEqual(1);
  });

  test('备份列表显示文件名、大小、时间', async ({ page }) => {
    await page.getByRole('button', { name: /立即备份/ }).click();
    await expect(page.getByText('备份已创建')).toBeVisible({ timeout: 10000 });
    const row = page.locator('tr.ant-table-row').first();
    await expect(row.getByText(/combat_backup_\d{8}_\d{6}\.db/)).toBeVisible();
    await expect(row.getByText(/(KB|MB|B)$/)).toBeVisible();
    await expect(row.getByText(/\d{4}-\d{2}-\d{2}/)).toBeVisible();
  });

  test('下载备份文件', async ({ page }) => {
    await page.getByRole('button', { name: /立即备份/ }).click();
    await expect(page.getByText('备份已创建')).toBeVisible({ timeout: 10000 });
    const row = page.locator('tr.ant-table-row').first();
    const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
    await row.getByText('下载').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/combat_backup_\d{8}_\d{6}\.db/);
  });

  test('删除备份', async ({ page }) => {
    await page.getByRole('button', { name: /立即备份/ }).click();
    await expect(page.getByText('备份已创建')).toBeVisible({ timeout: 10000 });
    const rowCount = await page.locator('tr.ant-table-row').count();
    if (rowCount > 0) {
      const row = page.locator('tr.ant-table-row').first();
      await row.getByText(/删\s?除/).click();
      await page.getByRole('button', { name: /确\s?定/ }).click();
      await expect(page.getByText('已删除')).toBeVisible({ timeout: 5000 });
    }
  });

  test('恢复数据库弹窗显示警告', async ({ page }) => {
    await page.getByRole('button', { name: /恢复数据库/ }).click();
    await expect(page.getByText('危险操作')).toBeVisible();
    await expect(page.getByText(/恢复数据库将用上传的备份文件完全替换当前数据库/)).toBeVisible();
    await expect(page.locator('.ant-upload-drag')).toBeVisible();
    await page.locator('.ant-modal-close').click();
  });

  test('恢复弹窗可关闭', async ({ page }) => {
    await page.getByRole('button', { name: /恢复数据库/ }).click();
    await expect(page.getByText('危险操作')).toBeVisible();
    await page.locator('.ant-modal-close').click();
    await expect(page.getByText('危险操作')).not.toBeVisible();
  });

  test('定时备份开关可见', async ({ page }) => {
    const switchEl = page.locator('.ant-switch');
    await expect(switchEl).toBeVisible();
  });

  test('备份频率下拉可选', async ({ page }) => {
    await fetch(`${BASE}/api/backup/schedule`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, intervalHours: 168, keepCount: 4 }),
    });
    await page.reload();
    await page.waitForSelector('.ant-card', { timeout: 10000 });
    const card = page.locator('.ant-card').filter({ hasText: '定时备份设置' });
    const select = card.locator('.ant-select').first();
    await expect(select).toBeVisible({ timeout: 5000 });
    await selectOption(page, select, '每天');
    await expect(page.getByText('定时备份设置已更新')).toBeVisible({ timeout: 5000 });
  });

  test('保留份数输入框可见', async ({ page }) => {
    const input = page.locator('.ant-input-number-input');
    await expect(input.first()).toBeVisible();
    await input.first().fill('6');
    await input.first().press('Enter');
    await expect(page.getByText('定时备份设置已更新')).toBeVisible({ timeout: 5000 });
  });

  test('开关切换', async ({ page }) => {
    const switchEl = page.locator('.ant-switch');
    await switchEl.click();
    await expect(page.getByText('定时备份设置已更新')).toBeVisible({ timeout: 5000 });
    await switchEl.click();
    await expect(page.getByText('定时备份设置已更新').first()).toBeVisible({ timeout: 5000 });
  });

  test('API: 获取定时设置', async () => {
    const res = await fetch(`${BASE}/api/backup/schedule`);
    expect(res.ok).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveProperty('enabled');
    expect(data).toHaveProperty('intervalHours');
    expect(data).toHaveProperty('keepCount');
  });

  test('API: 创建并获取备份列表', async () => {
    const createRes = await fetch(`${BASE}/api/backup`, { method: 'POST' });
    expect(createRes.ok).toBeTruthy();
    const created = await createRes.json();
    expect(created.filename).toMatch(/combat_backup_\d{8}_\d{6}\.db/);

    const listRes = await fetch(`${BASE}/api/backup`);
    expect(listRes.ok).toBeTruthy();
    const list = await listRes.json();
    expect(Array.isArray(list)).toBeTruthy();
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0]).toHaveProperty('filename');
    expect(list[0]).toHaveProperty('size');
    expect(list[0]).toHaveProperty('createdAt');
  });
});
