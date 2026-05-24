import { test, expect } from '@playwright/test';
import { API, selectOption, waitForTable } from './helpers';

test.describe('全员名单', () => {
  test('shows page heading and action buttons', async ({ page }) => {
    await page.goto('/people');
    await waitForTable(page);
    await expect(page.getByRole('heading', { name: '全员名单' })).toBeVisible();
    await expect(page.getByRole('button', { name: /添\s?加/ })).toBeVisible();
    await expect(page.getByRole('button', { name: '导入名单' })).toBeVisible();
    await expect(page.getByRole('button', { name: /导\s?出/ })).toBeVisible();
  });

  test('creates a person via drawer', async ({ page }) => {
    await page.goto('/people');
    await waitForTable(page);
    await page.getByRole('button', { name: /添\s?加/ }).click();

    await expect(page.locator('.ant-drawer')).toBeVisible();
    await page.locator('.ant-drawer').getByLabel('姓名').fill('E2E测试人员');
    await page.locator('.ant-drawer').getByLabel('工号').fill('E2E001');
    await page.locator('.ant-drawer').getByLabel('邮箱').fill('e2e@test.com');
    await page.locator('.ant-drawer').getByLabel('部门').fill('测试部');
    await page.locator('.ant-drawer-extra button').click();
    await expect(page.getByText('添加成功')).toBeVisible();
    await expect(page.getByText('E2E测试人员')).toBeVisible();
    await expect(page.getByText('E2E001')).toBeVisible();
  });

  test('lists people in table', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/person`, {
      data: { 姓名: 'E2E张三', 工号: 'P001', 邮箱: 'zhangsan@test.com', 部门: 'SRE' },
    });
    await request.post(`${API}/api/nodes/person`, {
      data: { 姓名: 'E2E李四', 工号: 'P002', 邮箱: 'lisi@test.com', 部门: '研发' },
    });

    await page.goto('/people');
    await waitForTable(page);
    await expect(page.getByText('E2E张三')).toBeVisible();
    await expect(page.getByText('E2E李四')).toBeVisible();
    await expect(page.getByText('SRE').first()).toBeVisible();
    await expect(page.getByText('研发').first()).toBeVisible();
  });

  test('searches by name/email/id', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/person`, {
      data: { 姓名: 'E2E搜索甲', 工号: 'S001', 邮箱: 'jia@test.com', 部门: 'SRE' },
    });
    await request.post(`${API}/api/nodes/person`, {
      data: { 姓名: 'E2E搜索乙', 工号: 'S002', 邮箱: 'yi@test.com', 部门: '研发' },
    });

    await page.goto('/people');
    await waitForTable(page);
    await page.getByPlaceholder('搜索姓名/邮箱/工号').fill('搜索甲');
    await expect(page.getByText('E2E搜索甲')).toBeVisible();
    await expect(page.getByText('E2E搜索乙')).not.toBeVisible();
  });

  test('filters by department', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/person`, {
      data: { 姓名: 'E2E部门甲', 工号: 'D001', 部门: 'SRE' },
    });
    await request.post(`${API}/api/nodes/person`, {
      data: { 姓名: 'E2E部门乙', 工号: 'D002', 部门: '研发' },
    });

    await page.goto('/people');
    await waitForTable(page);
    await expect(page.getByText('E2E部门甲')).toBeVisible();
    await expect(page.getByText('E2E部门乙')).toBeVisible();

    const deptSelect = page.locator('.ant-select').nth(1);
    await selectOption(page, deptSelect, 'SRE');
    await expect(page.getByText('E2E部门甲')).toBeVisible();
    await expect(page.getByText('E2E部门乙')).not.toBeVisible();
  });

  test('deletes a person', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/person`, {
      data: { 姓名: 'E2E待删除人', 工号: 'DEL001' },
    });

    await page.goto('/people');
    await waitForTable(page);
    await expect(page.getByText('E2E待删除人')).toBeVisible();
    await page.getByRole('row').filter({ hasText: 'E2E待删除人' }).locator('a').last().click();
    await page.getByRole('button', { name: /确\s?定/ }).click();
    await expect(page.getByText('删除成功')).toBeVisible();
  });

  test('exports people list', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/person`, {
      data: { 姓名: 'E2E导出人', 工号: 'EXP001' },
    });

    await page.goto('/people');
    await waitForTable(page);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /导\s?出/ }).click();
    const d = await download;
    expect(d.suggestedFilename()).toContain('.xlsx');
  });

  test('opens and closes import drawer', async ({ page }) => {
    await page.goto('/people');
    await waitForTable(page);
    await page.getByRole('button', { name: '导入名单' }).click();
    await expect(page.locator('.ant-drawer')).toBeVisible();
    await expect(page.getByText('点击或拖拽 Excel 文件到此处')).toBeVisible();
    await page.locator('.ant-drawer-close').click();
  });
});
