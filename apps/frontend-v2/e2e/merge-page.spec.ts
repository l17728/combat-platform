import { test, expect } from '@playwright/test';
import { API } from './helpers';

test.describe('人员合并', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/merge');
    await page.waitForLoadState('networkidle');
  });

  test('shows page heading and warning alert', async ({ page }) => {
    await expect(page.getByRole('heading', { name: '人员合并' })).toBeVisible();
    await expect(page.getByText('此操作不可逆')).toBeVisible();
  });

  test('shows two person select dropdowns', async ({ page }) => {
    const selects = page.locator('.ant-select');
    expect(await selects.count()).toBeGreaterThanOrEqual(2);
  });

  test('select same person shows error alert', async ({ page }) => {
    const person = await page.request.post(`${API}/api/nodes/person`, {
      headers: { 'Content-Type': 'application/json', 'X-Role': 'leader' },
      data: { '名称': 'SamePersonTest' },
    });
    if (!person.ok()) return;
    const { id } = await person.json();

    const selects = page.locator('.ant-select');
    await selects.first().locator('.ant-select-selector').click();
    await page.waitForTimeout(300);
    const dropdown = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').last();
    const opt = dropdown.locator('.ant-select-item-option').filter({ hasText: 'SamePersonTest' }).first();
    if (await opt.isVisible()) await opt.dispatchEvent('click');

    await selects.nth(1).locator('.ant-select-selector').click();
    await page.waitForTimeout(300);
    const dropdown2 = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').last();
    const opt2 = dropdown2.locator('.ant-select-item-option').filter({ hasText: 'SamePersonTest' }).first();
    if (await opt2.isVisible()) await opt2.dispatchEvent('click');

    await page.waitForTimeout(300);
    await expect(page.getByText('不能选择同一人员')).toBeVisible();
  });

  test('preview merge shows comparison', async ({ page }) => {
    const p1 = await page.request.post(`${API}/api/nodes/person`, {
      headers: { 'Content-Type': 'application/json', 'X-Role': 'leader' },
      data: { '名称': 'MergePreviewA', '部门': '测试部' },
    });
    const p2 = await page.request.post(`${API}/api/nodes/person`, {
      headers: { 'Content-Type': 'application/json', 'X-Role': 'leader' },
      data: { '名称': 'MergePreviewB', '部门': '研发部' },
    });
    if (!p1.ok() || !p2.ok()) return;
    const { id: id1 } = await p1.json();
    const { id: id2 } = await p2.json();

    await page.reload();
    await page.waitForLoadState('networkidle');

    const selects = page.locator('.ant-select');

    await selects.first().locator('.ant-select-selector').click();
    await page.waitForTimeout(300);
    let dropdown = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').last();
    await dropdown.locator('.ant-select-item-option').filter({ hasText: 'MergePreviewA' }).first().dispatchEvent('click');
    await page.waitForTimeout(200);

    await selects.nth(1).locator('.ant-select-selector').click();
    await page.waitForTimeout(300);
    dropdown = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').last();
    await dropdown.locator('.ant-select-item-option').filter({ hasText: 'MergePreviewB' }).first().dispatchEvent('click');
    await page.waitForTimeout(200);

    await page.getByRole('button', { name: '预览合并' }).click();
    await page.waitForTimeout(1000);

    await expect(page.getByText('合并预览')).toBeVisible();
    await expect(page.getByText('被合并')).toBeVisible();
    await expect(page.getByText('保留')).toBeVisible();
  });

  test('execute merge via popconfirm', async ({ page }) => {
    const p1 = await page.request.post(`${API}/api/nodes/person`, {
      headers: { 'Content-Type': 'application/json', 'X-Role': 'leader' },
      data: { '名称': 'MergeExecA' },
    });
    const p2 = await page.request.post(`${API}/api/nodes/person`, {
      headers: { 'Content-Type': 'application/json', 'X-Role': 'leader' },
      data: { '名称': 'MergeExecB' },
    });
    if (!p1.ok() || !p2.ok()) return;
    const { id: id1 } = await p1.json();
    const { id: id2 } = await p2.json();

    await page.reload();
    await page.waitForLoadState('networkidle');

    const selects = page.locator('.ant-select');
    await selects.first().locator('.ant-select-selector').click();
    await page.waitForTimeout(300);
    let dropdown = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').last();
    await dropdown.locator('.ant-select-item-option').filter({ hasText: 'MergeExecA' }).first().dispatchEvent('click');
    await page.waitForTimeout(200);

    await selects.nth(1).locator('.ant-select-selector').click();
    await page.waitForTimeout(300);
    dropdown = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').last();
    await dropdown.locator('.ant-select-item-option').filter({ hasText: 'MergeExecB' }).first().dispatchEvent('click');
    await page.waitForTimeout(200);

    await page.getByRole('button', { name: '预览合并' }).click();
    await page.waitForTimeout(1000);

    await page.getByRole('button', { name: '执行合并' }).click();
    await page.waitForTimeout(300);
    await page.locator('.ant-popconfirm').getByRole('button', { name: /确\s?认|OK/ }).click();
    await page.waitForTimeout(1500);

    const msg = page.locator('.ant-message');
    await expect(msg).toBeVisible({ timeout: 5000 });
  });
});
