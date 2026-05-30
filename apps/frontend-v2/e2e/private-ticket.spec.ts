import { test, expect } from '@playwright/test';
import { API, waitForTable, waitForDrawer, selectOption } from './helpers';

test.describe('攻关单私密功能', () => {
  test('只有创建人可见「设置私密」按钮', async ({ page, request }) => {
    // 别人创建的攻关单(创建人=其他用户)
    const otherRes = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E他人攻关单', 状态: '处理中', 创建人: '其他用户XYZ' },
    });
    const other = await otherRes.json();
    await page.goto(`/attack/${other.id}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('button', { name: /设置私密/ })).toHaveCount(0);
  });

  test('创建人可见「设置私密」按钮 + 打开抽屉 + 列表加锁图标', async ({ page, request }) => {
    const res = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E私密测试单', 状态: '处理中' },
    });
    const ticket = await res.json();
    expect(ticket.properties['创建人']).toBe('admin');

    await page.goto(`/attack/${ticket.id}`);
    await page.waitForLoadState('networkidle');
    const lockBtn = page.getByRole('button', { name: /设置私密/ });
    await expect(lockBtn).toBeVisible();

    await lockBtn.click();
    await waitForDrawer(page);
    const drawer = page.locator('.ant-drawer').last();
    await expect(drawer.getByText('私密攻关单的访问规则')).toBeVisible();
    await expect(drawer.getByText('指定授权人员')).toBeVisible();
    await expect(drawer.getByText('指定授权邮件群组')).toBeVisible();

    // 直接保存(空白授权也算设为私密 — 仅创建人+成员可访问)
    await drawer.locator('.ant-drawer-extra button').click();
    await expect(page.getByText('已设置为私密')).toBeVisible({ timeout: 5000 });

    // 列表里该单应有 🔒 图标(标题列)
    await page.goto('/attack');
    await waitForTable(page);
    const row = page.getByRole('row').filter({ hasText: 'E2E私密测试单' });
    await expect(row.locator('.anticon-lock')).toBeVisible();

    // 详情按钮变为「管理私密授权」+「取消私密」
    await page.goto(`/attack/${ticket.id}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('button', { name: /管理私密授权/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /取消私密/ })).toBeVisible();
  });

  test('取消私密后列表锁图标消失,详情按钮恢复', async ({ page, request }) => {
    const res = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E私密取消测试单', 状态: '处理中', 私密: '是', 私密授权人: '[]', 私密授权组: '[]' },
    });
    const ticket = await res.json();
    await page.goto(`/attack/${ticket.id}`);
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: '取消私密' }).click();
    // Popconfirm 出现后,在弹层内点 OK
    await page.locator('.ant-popover .ant-btn-primary').filter({ hasText: /确\s?定/ }).click();
    await expect(page.getByText('已取消私密')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(500); // 等 fetchData 完成 setState 再切换 UI

    // 详情按钮恢复:仅剩「设置私密」,无「取消私密」/「管理私密授权」
    await expect(page.getByRole('button', { name: '设置私密' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: '管理私密授权' })).toHaveCount(0);
    // 列表锁图标消失
    await page.goto('/attack');
    await waitForTable(page);
    const row = page.getByRole('row').filter({ hasText: 'E2E私密取消测试单' });
    await expect(row.locator('.anticon-lock')).toHaveCount(0);
  });
});
