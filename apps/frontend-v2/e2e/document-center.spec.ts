import { test, expect } from '@playwright/test';
import { API } from './helpers';

test.describe('文档中心', () => {
  test('shows heading and action buttons', async ({ page }) => {
    await page.goto('/documents');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: '文档中心' })).toBeVisible();
    await expect(page.getByRole('button', { name: /上传文档/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /添加链接/ })).toBeVisible();
  });

  test('add external link, copy markdown, delete', async ({ page }) => {
    await page.goto('/documents');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /添加链接/ }).click();
    const modal = page.locator('.ant-modal').filter({ hasText: '添加外链文档' });
    await expect(modal).toBeVisible();
    await modal.getByPlaceholder('如：发布流程 SOP').fill('E2E外链文档');
    await modal.getByPlaceholder('https://...').fill('https://example.com');
    await modal.getByRole('button', { name: /添\s?加/ }).click();

    await expect(page.getByText('外链文档已添加')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('cell', { name: 'E2E外链文档' })).toBeVisible();

    const row = page.getByRole('row').filter({ hasText: 'E2E外链文档' });
    await row.getByText('复制Markdown').click();
    await expect(page.getByText(/Markdown 已复制|复制失败/)).toBeVisible();

    await row.getByText('删除').click();
    await page.getByRole('button', { name: /确\s?定/ }).click();
    await expect(page.getByText('删除成功')).toBeVisible();
  });

  test('API-uploaded file is listed', async ({ page }) => {
    await page.request.post(`${API}/api/documents`, {
      multipart: { file: { name: 'E2E上传文件.txt', mimeType: 'text/plain', buffer: Buffer.from('e2e file content') } },
    });
    await page.goto('/documents');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('cell', { name: 'E2E上传文件.txt' })).toBeVisible({ timeout: 10000 });
  });
});
