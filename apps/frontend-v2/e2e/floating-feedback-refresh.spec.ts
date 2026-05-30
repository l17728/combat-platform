import { test, expect } from '@playwright/test';
import { API } from './helpers';

test.describe('截图反馈悬浮按钮 - 提交后实时刷新 BugReport 列表', () => {
  test('在 BugReport 页用悬浮按钮提交后,新条目立即出现在列表', async ({ page, request }) => {
    // 先清空可能残留的同标题数据
    const existing = await request.get(`${API}/api/bug-reports`);
    if (existing.ok()) {
      const arr = await existing.json();
      for (const b of arr) {
        if (b?.title?.startsWith?.('E2E悬浮刷新-')) {
          await request.delete(`${API}/api/bug-reports/${b.id}`).catch(() => {});
        }
      }
    }

    await page.goto('/bug-report');
    await page.waitForLoadState('networkidle');

    // 触发右下角 FloatButton(截图反馈),浮窗内填写并提交
    await page.locator('.feedback-float-ignore').click();
    const drawer = page.locator('.ant-drawer').filter({ hasText: '截图反馈' });
    await expect(drawer).toBeVisible({ timeout: 5000 });

    const title = `E2E悬浮刷新-${Date.now()}`;
    await drawer.getByLabel('问题标题').fill(title);
    await drawer.getByLabel('问题描述').fill('e2e 验证浮窗提交后列表自动刷新');
    // 提交反馈按钮在抽屉 extra
    await drawer.locator('.ant-drawer-extra button').click();
    await expect(page.getByText('反馈已提交')).toBeVisible({ timeout: 8000 });

    // 抽屉关闭后,BugReport 列表行应立即出现(无需刷新页面)
    await expect(page.locator('tbody').getByText(title)).toBeVisible({ timeout: 5000 });
  });
});
