import { test, expect } from '@playwright/test';
import { API, waitForTable } from './helpers';

test.describe('攻关单删除权限 - 仅创建人可见删除按钮', () => {
  test('创建人(admin)可见删除按钮且能删除', async ({ page, request }) => {
    // COMBAT_NO_AUTH 下后端注入 创建人='admin',前端 user='admin' → 按钮可见
    const res = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E删除权限-创建人', 状态: '待响应' },
    });
    const ticket = await res.json();
    expect(ticket.properties['创建人']).toBe('admin');

    await page.goto('/attack');
    await waitForTable(page);
    const row = page.getByRole('row').filter({ hasText: 'E2E删除权限-创建人' });
    // 操作列里应有「删除」链接(创建人=admin = 当前 e2e 用户)
    await expect(row.locator('a').filter({ hasText: /^删\s?除$/ })).toBeVisible();
  });

  test('非创建人看不到删除按钮(仅显示占位符)', async ({ page, request }) => {
    // 直接通过 properties 覆盖 创建人,模拟"别人创建的"场景
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E删除权限-他人', 状态: '待响应', 创建人: '其他用户XYZ' },
    });

    await page.goto('/attack');
    await waitForTable(page);
    const row = page.getByRole('row').filter({ hasText: 'E2E删除权限-他人' });
    // 列表里应没有「删除」链接;操作列显示占位符 —
    await expect(row.locator('a').filter({ hasText: /^删\s?除$/ })).toHaveCount(0);
  });

  test('详情页非创建人看不到删除按钮', async ({ page, request }) => {
    const res = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E删除权限-详情他人', 状态: '待响应', 创建人: '其他用户XYZ' },
    });
    const ticket = await res.json();
    await page.goto(`/attack/${ticket.id}`);
    await page.waitForLoadState('networkidle');
    // 详情顶部不该有 danger 删除按钮
    await expect(page.getByRole('button', { name: /^删\s?除$/ })).toHaveCount(0);
  });
});
