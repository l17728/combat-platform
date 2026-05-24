import { test, expect } from '@playwright/test';

const API = 'http://localhost:3001';

test.describe('贡献录入', () => {
  test('shows page heading and create button', async ({ page }) => {
    await page.goto('/contributions');
    await expect(page.getByRole('heading', { name: '贡献录入' })).toBeVisible();
    await expect(page.getByRole('button', { name: '录入贡献' })).toBeVisible();
  });

  test('creates a contribution via drawer', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/person`, {
      data: { 姓名: 'E2E贡献人' },
    });

    await page.goto('/contributions');
    await page.getByRole('button', { name: '录入贡献' }).click();

    const drawer = page.getByLabel('录入贡献');
    await expect(drawer).toBeVisible();
    await drawer.getByPlaceholder('从名单搜索').click();
    await page.getByRole('option', { name: 'E2E贡献人' }).click();
    await drawer.getByPlaceholder('选择类型').click();
    await page.getByRole('option', { name: '实施' }).click();
    await drawer.getByPlaceholder('选择等级').click();
    await page.getByRole('option', { name: '核心' }).click();
    await drawer.getByPlaceholder(/贡献描述/).fill('E2E测试贡献描述');
    await page.locator('.ant-drawer-extra').getByRole('button', { name: '提交' }).click();
    await expect(page.getByText('录入成功')).toBeVisible();
    await expect(page.getByRole('cell', { name: 'E2E贡献人' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'E2E测试贡献描述' })).toBeVisible();
  });

  test('lists contributions in table', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/contribution`, {
      data: { 贡献人: 'E2E列表贡献人', 贡献等级: '核心', 贡献类型: '发现', 描述: 'E2E列表贡献' },
    });

    await page.goto('/contributions');
    await expect(page.getByRole('cell', { name: 'E2E列表贡献人' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'E2E列表贡献' })).toBeVisible();
  });

  test('filters by contribution level', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/contribution`, {
      data: { 贡献人: 'E2E核心人', 贡献等级: '核心', 贡献类型: '实施', 描述: 'E2E核心贡献' },
    });
    await request.post(`${API}/api/nodes/contribution`, {
      data: { 贡献人: 'E2E普通人', 贡献等级: '普通', 贡献类型: '实施', 描述: 'E2E普通贡献' },
    });

    await page.goto('/contributions');
    await expect(page.getByRole('cell', { name: 'E2E核心贡献' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'E2E普通贡献' })).toBeVisible();

    await page.getByPlaceholder('贡献等级').click();
    await page.getByRole('option', { name: '核心' }).click();
    await expect(page.getByRole('cell', { name: 'E2E核心贡献' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'E2E普通贡献' })).not.toBeVisible();
  });

  test('searches by contributor name', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/contribution`, {
      data: { 贡献人: 'E2E搜索贡献人', 贡献等级: '关键', 贡献类型: '协调', 描述: 'E2E搜索贡献' },
    });
    await request.post(`${API}/api/nodes/contribution`, {
      data: { 贡献人: 'E2E其他贡献人', 贡献等级: '普通', 贡献类型: '支持', 描述: 'E2E其他贡献' },
    });

    await page.goto('/contributions');
    await page.getByPlaceholder('搜索贡献人/描述').fill('搜索贡献人');
    await expect(page.getByRole('cell', { name: 'E2E搜索贡献人' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'E2E其他贡献人' })).not.toBeVisible();
  });

  test('deletes a contribution', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/contribution`, {
      data: { 贡献人: 'E2E待删贡献人', 贡献等级: '普通', 贡献类型: '支持', 描述: 'E2E待删贡献' },
    });

    await page.goto('/contributions');
    await expect(page.getByRole('cell', { name: 'E2E待删贡献' })).toBeVisible();
    await page.getByRole('row').filter({ hasText: 'E2E待删贡献' }).getByText('删除').click();
    await page.getByRole('button', { name: '确 定' }).click();
    await expect(page.getByText('删除成功')).toBeVisible();
  });

  test('click contributor name navigates to honor page', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/contribution`, {
      data: { 贡献人: 'E2E跳转贡献人', 贡献等级: '核心', 贡献类型: '实施', 描述: 'E2E跳转贡献' },
    });

    await page.goto('/contributions');
    await page.getByRole('cell', { name: 'E2E跳转贡献人' }).click();
    await expect(page).toHaveURL(/\/honor\//);
  });
});

test.describe('荣誉殿堂', () => {
  test('shows page heading', async ({ page }) => {
    await page.goto('/honor');
    await expect(page.getByRole('heading', { name: '荣誉殿堂' })).toBeVisible();
  });

  test('shows empty state when no data', async ({ page }) => {
    await page.goto('/honor');
    await expect(page.getByText('暂无贡献数据')).toBeVisible();
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
    await expect(page.getByText('详细排行')).toBeVisible();
  });

  test('click person in leaderboard navigates to detail', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/contribution`, {
      data: { 贡献人: 'E2E排行人', 贡献等级: '关键', 贡献类型: '发现', 描述: 'E2E排行贡献' },
    });

    await page.goto('/honor');
    await page.getByText('E2E排行人').first().click();
    await expect(page).toHaveURL(/\/honor\//);
    await expect(page.getByRole('heading', { name: 'E2E排行人' })).toBeVisible();
  });
});

test.describe('个人荣誉详情', () => {
  test('shows person honor with contributions', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/contribution`, {
      data: { 贡献人: 'E2E个人详情', 贡献等级: '关键', 贡献类型: '发现', 描述: 'E2E关键发现' },
    });
    await request.post(`${API}/api/nodes/contribution`, {
      data: { 贡献人: 'E2E个人详情', 贡献等级: '核心', 贡献类型: '实施', 描述: 'E2E核心实施' },
    });

    await page.goto('/honor');
    await page.getByText('E2E个人详情').first().click();
    await expect(page.getByRole('heading', { name: 'E2E个人详情' })).toBeVisible();
    await expect(page.getByText('E2E关键发现')).toBeVisible();
    await expect(page.getByText('E2E核心实施')).toBeVisible();
  });

  test('back button returns to honor page', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/contribution`, {
      data: { 贡献人: 'E2E返回测试人', 贡献等级: '普通', 贡献类型: '支持', 描述: 'E2E返回测试' },
    });

    await page.goto('/honor');
    await page.getByText('E2E返回测试人').first().click();
    await expect(page).toHaveURL(/\/honor\//);

    await page.getByRole('link', { name: '返回荣誉殿堂' }).click();
    await expect(page).toHaveURL('/honor');
  });
});
