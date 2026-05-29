import { test, expect } from '@playwright/test';
import { API, opsCell, selectOption, waitForDrawer, waitForTable } from './helpers';

test.describe('贡献录入', () => {
  test('shows page heading and create button', async ({ page }) => {
    await page.goto('/contributions');
    await waitForTable(page);
    await expect(page.getByRole('heading', { name: '贡献录入' })).toBeVisible();
    await expect(page.getByRole('button', { name: '录入个人贡献' })).toBeVisible();
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
    await page.getByRole('button', { name: '录入个人贡献' }).click();
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

    const levelSelect = page.locator('.ant-select').nth(0);
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

test.describe('团队贡献', () => {
  test('creates a team contribution via drawer with 组长/组员', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/person`, { data: { 姓名: 'E2E组长甲' } });
    await request.post(`${API}/api/nodes/person`, { data: { 姓名: 'E2E组员乙' } });

    await page.goto('/contributions');
    await waitForTable(page);
    await page.getByRole('button', { name: '录入团队贡献' }).click();
    await waitForDrawer(page);

    const drawer = page.locator('.ant-drawer');
    await drawer.getByPlaceholder('团队名称').fill('E2E攻坚团队');
    const sels = drawer.locator('.ant-select');
    // 0=贡献类型 1=贡献等级 2=组长 3=组员 4=关联攻关单
    await selectOption(page, sels.nth(1), '核心');
    await drawer.getByPlaceholder('贡献描述').fill('E2E团队协同攻坚');
    await selectOption(page, sels.nth(2), 'E2E组长甲');
    await selectOption(page, sels.nth(3), 'E2E组员乙');
    // 多选下拉保持打开，点回团队名称输入框关闭它，避免遮挡提交按钮
    await drawer.getByPlaceholder('团队名称').click();

    await page.locator('.ant-drawer-extra button').click();
    await expect(page.getByText('录入成功')).toBeVisible();
    await expect(page.getByRole('cell', { name: 'E2E攻坚团队', exact: true })).toBeVisible();
  });

  test('lists team contribution with 组员 array rendered', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/teamContribution`, {
      data: { 团队名称: 'E2E列表团队', 贡献等级: '关键', 贡献类型: '实施', 组长: '张三', 组员: ['李四', '王五'] },
    });

    await page.goto('/contributions');
    await waitForTable(page);
    await expect(page.getByRole('cell', { name: 'E2E列表团队', exact: true })).toBeVisible();
    const row = page.getByRole('row').filter({ hasText: 'E2E列表团队' });
    await expect(row.getByText('李四')).toBeVisible();
    await expect(row.getByText('王五')).toBeVisible();
  });

  test('edits a team contribution via drawer (组员 array prefilled)', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/teamContribution`, {
      data: { 团队名称: 'E2E待编辑团队', 贡献等级: '普通', 贡献类型: '实施', 描述: '原始描述', 组长: '张三', 组员: ['李四'] },
    });
    await page.goto('/contributions');
    await waitForTable(page);
    const row = page.getByRole('row').filter({ hasText: 'E2E待编辑团队' });
    await opsCell(row).getByText('编辑').click();
    await waitForDrawer(page);
    const drawer = page.locator('.ant-drawer');
    const desc = drawer.getByPlaceholder('贡献描述');
    await desc.fill('已更新的团队描述');
    await page.locator('.ant-drawer-extra button').click();
    await expect(page.getByText('更新成功')).toBeVisible();
    await expect(page.getByRole('cell', { name: 'E2E待编辑团队', exact: true })).toBeVisible();
  });

  test('deletes a team contribution', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/teamContribution`, {
      data: { 团队名称: 'E2E待删团队', 贡献等级: '普通', 贡献类型: '实施', 组长: '张三' },
    });
    await page.goto('/contributions');
    await waitForTable(page);
    const row = page.getByRole('row').filter({ hasText: 'E2E待删团队' });
    await opsCell(row).getByText(/删\s?除/).click();
    await page.getByRole('button', { name: /确\s?定/ }).click();
    await expect(page.getByText('删除成功')).toBeVisible();
    await expect(page.getByRole('cell', { name: 'E2E待删团队', exact: true })).not.toBeVisible();
  });
});

test.describe('荣誉殿堂', () => {
  test('shows page heading', async ({ page }) => {
    await page.goto('/honor');
    await expect(page.getByRole('heading', { name: '荣誉殿堂' })).toBeVisible();
  });

  test('团队荣誉 tab groups teams by level and shows detail on click', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/teamContribution`, {
      data: { 团队名称: 'E2E荣誉团队', 贡献等级: '核心', 贡献类型: '实施', 描述: 'E2E团队荣誉描述', 组长: '赵敏', 组员: ['钱七', '孙八'] },
    });

    await page.goto('/honor');
    await page.getByRole('tab', { name: '团队荣誉' }).click();
    await expect(page.getByText('E2E荣誉团队').first()).toBeVisible();

    await page.getByText('E2E荣誉团队').first().click();
    // 右侧详情面板
    await expect(page.getByText('E2E团队荣誉描述')).toBeVisible();
    await expect(page.locator('.ant-descriptions').getByText('赵敏')).toBeVisible();
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
