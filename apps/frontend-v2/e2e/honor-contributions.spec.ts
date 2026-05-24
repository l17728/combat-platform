import { test, expect } from '@playwright/test';

const API = 'http://localhost:3001';

test.describe('贡献录入', () => {
  test('shows empty state', async ({ page }) => {
    await page.goto('/contributions');
    await expect(page.getByText('贡献录入')).toBeVisible();
  });

  test('creates a contribution', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/person`, {
      data: { 姓名: 'E2E贡献人' },
    });

    await page.goto('/contributions');
    await page.getByRole('button', { name: '录入贡献' }).click();
    await expect(page.getByText('录入贡献')).toBeVisible();

    await page.getByLabel('贡献人').click();
    await page.getByText('E2E贡献人').click();
    await page.getByLabel('贡献类型').click();
    await page.getByText('实施').click();
    await page.getByLabel('贡献等级').click();
    await page.getByText('核心').click();
    await page.getByLabel('贡献描述').fill('E2E测试贡献描述');
    await page.getByRole('button', { name: '提交' }).click();
    await expect(page.getByText('录入成功')).toBeVisible();
  });
});

test.describe('荣誉殿堂', () => {
  test('shows empty leaderboard', async ({ page }) => {
    await page.goto('/honor');
    await expect(page.getByText('荣誉殿堂')).toBeVisible();
  });

  test('shows leaderboard with data', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/person`, {
      data: { 姓名: 'E2E荣誉人' },
    });
    await request.post(`${API}/api/nodes/contribution`, {
      data: { 贡献人: 'E2E荣誉人', 贡献等级: '核心', 贡献类型: '实施', 描述: 'E2E核心贡献' },
    });

    await page.goto('/honor');
    await expect(page.getByText('E2E荣誉人')).toBeVisible();
  });

  test('navigates to person honor detail', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/contribution`, {
      data: { 贡献人: 'E2E个人详情', 贡献等级: '关键', 贡献类型: '发现', 描述: 'E2E关键发现' },
    });

    await page.goto('/honor');
    await page.getByText('E2E个人详情').click();
    await expect(page.getByText('E2E个人详情')).toBeVisible();
    await expect(page.getByText('E2E关键发现')).toBeVisible();
  });
});
