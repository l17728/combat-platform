import { test, expect } from '@playwright/test';
import { API, opsCell, selectOption, waitForDrawer, waitForTable } from './helpers';

test.describe('贡献录入', () => {
  test('shows page heading and create button', async ({ page }) => {
    await page.goto('/contributions');
    await waitForTable(page);
    await expect(page.getByRole('heading', { name: '贡献录入' })).toBeVisible();
    await expect(page.getByRole('button', { name: '录入贡献' })).toBeVisible();
  });

  test('creates a contribution via drawer', async ({ page, request }) => {
    await page.addInitScript(() => {
      localStorage.setItem('combat-role', 'leader');
    });

    await request.post(`${API}/api/nodes/person`, {
      data: { 姓名: 'E2E贡献人' },
    });

    await page.goto('/contributions');
    await waitForTable(page);
    await page.getByRole('button', { name: '录入贡献' }).click();
    await waitForDrawer(page);

    const drawer = page.locator('.ant-drawer');
    const drawerSelects = drawer.locator('.ant-select');

    await selectOption(page, drawerSelects.first(), 'E2E贡献人');
    await selectOption(page, drawerSelects.nth(1), '实施');
    await selectOption(page, drawerSelects.nth(2), '核心');

    await page.getByPlaceholder(/贡献描述/).fill('E2E测试贡献描述');

    await page.locator('.ant-drawer-extra button').click();
    await expect(page.getByText('录入成功')).toBeVisible();
    await expect(page.getByRole('cell', { name: 'E2E贡献人' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'E2E测试贡献描述', exact: true })).toBeVisible();
  });

  test('lists contributions in table', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/contribution`, {
      data: { 贡献人: 'E2E列表贡献人', 贡献等级: '核心', 贡献类型: '发现', 描述: 'E2E列表贡献' },
    });

    await page.goto('/contributions');
    await waitForTable(page);
    await expect(page.getByRole('cell', { name: 'E2E列表贡献人', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'E2E列表贡献', exact: true })).toBeVisible();
  });

  test('filters by contribution level', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/contribution`, {
      data: { 贡献人: 'E2E核心人', 贡献等级: '核心', 贡献类型: '实施', 描述: 'E2E核心贡献' },
    });
    await request.post(`${API}/api/nodes/contribution`, {
      data: { 贡献人: 'E2E普通人', 贡献等级: '普通', 贡献类型: '实施', 描述: 'E2E普通贡献' },
    });

    await page.goto('/contributions');
    await waitForTable(page);
    await expect(page.getByRole('cell', { name: 'E2E核心贡献', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'E2E普通贡献', exact: true })).toBeVisible();

    const levelSelect = page.locator('.ant-select').nth(1);
    await selectOption(page, levelSelect, '核心', true);
    await expect(page.getByRole('cell', { name: 'E2E核心贡献', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'E2E普通贡献', exact: true })).not.toBeVisible();
  });

  test('searches by contributor name', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/contribution`, {
      data: { 贡献人: 'E2E搜索贡献人', 贡献等级: '关键', 贡献类型: '协调', 描述: 'E2E搜索贡献' },
    });
    await request.post(`${API}/api/nodes/contribution`, {
      data: { 贡献人: 'E2E其他贡献人', 贡献等级: '普通', 贡献类型: '公关', 描述: 'E2E其他贡献' },
    });

    await page.goto('/contributions');
    await waitForTable(page);
    await page.getByPlaceholder('搜索贡献人/描述').fill('搜索贡献人');
    await expect(page.getByRole('cell', { name: 'E2E搜索贡献人', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'E2E其他贡献人', exact: true })).not.toBeVisible();
  });

  test('deletes a contribution', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/contribution`, {
      data: { 贡献人: 'E2E待删贡献人', 贡献等级: '普通', 贡献类型: '公关', 描述: 'E2E待删贡献' },
    });

    await page.goto('/contributions');
    await waitForTable(page);
    await expect(page.getByRole('cell', { name: 'E2E待删贡献', exact: true })).toBeVisible();
    await opsCell(page.getByRole('row').filter({ hasText: 'E2E待删贡献' })).locator('a').filter({ hasText: /删\s?除/ }).click();
    await page.getByRole('button', { name: /确\s?定/ }).click();
    await expect(page.getByText('删除成功')).toBeVisible();
  });

  test('click contributor name navigates to honor page', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/contribution`, {
      data: { 贡献人: 'E2E跳转贡献人', 贡献等级: '核心', 贡献类型: '实施', 描述: 'E2E跳转贡献' },
    });

    await page.goto('/contributions');
    await waitForTable(page);
    await page.getByRole('cell', { name: 'E2E跳转贡献人', exact: true }).locator('a').click();
    await expect(page).toHaveURL(/\/honor\//);
  });
});

test.describe('荣誉殿堂', () => {
  test('shows page heading', async ({ page }) => {
    await page.goto('/honor');
    await expect(page.getByRole('heading', { name: '荣誉殿堂' })).toBeVisible();
  });

  test('shows leaderboard with data', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/person`, {
      data: { 姓名: 'E2E荣誉人' },
    });
    await request.post(`${API}/api/nodes/contribution`, {
      data: { 贡献人: 'E2E荣誉人', 贡献等级: '核心', 贡献类型: '实施', 描述: 'E2E核心贡献' },
    });

    await page.goto('/honor');
    await expect(page.getByText('E2E荣誉人').first()).toBeVisible();
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
      data: { 贡献人: 'E2E返回测试人', 贡献等级: '普通', 贡献类型: '公关', 描述: 'E2E返回测试' },
    });

    await page.goto('/honor');
    await page.getByText('E2E返回测试人').first().click();
    await expect(page).toHaveURL(/\/honor\//);

    await page.getByRole('button', { name: '返回荣誉殿堂' }).click();
    await expect(page).toHaveURL('/honor');
  });
});
