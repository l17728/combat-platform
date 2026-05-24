import { test, expect } from '@playwright/test';

const API = 'http://localhost:3001';

test.describe('全员名单', () => {
  test('shows empty state', async ({ page }) => {
    await page.goto('/people');
    await expect(page.getByText('全员名单')).toBeVisible();
  });

  test('creates a person', async ({ page }) => {
    await page.goto('/people');
    await page.getByRole('button', { name: '添加' }).click();
    await page.getByLabel('姓名').fill('E2E测试人员');
    await page.getByLabel('工号').fill('E2E001');
    await page.getByLabel('邮箱').fill('e2e@test.com');
    await page.getByLabel('部门').fill('测试部');
    await page.getByRole('button', { name: '添加' }).click();
    await expect(page.getByText('添加成功')).toBeVisible();
  });

  test('lists and filters people', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/person`, {
      data: { 姓名: 'E2E张三', 工号: 'P001', 邮箱: 'zhangsan@test.com', 部门: 'SRE' },
    });
    await request.post(`${API}/api/nodes/person`, {
      data: { 姓名: 'E2E李四', 工号: 'P002', 邮箱: 'lisi@test.com', 部门: '研发' },
    });

    await page.goto('/people');
    await expect(page.getByText('E2E张三')).toBeVisible();
    await expect(page.getByText('E2E李四')).toBeVisible();

    await page.getByPlaceholder('搜索姓名/邮箱/工号').fill('张三');
    await expect(page.getByText('E2E李四')).toHaveCount(0);
    await expect(page.getByText('E2E张三')).toBeVisible();
  });
});
