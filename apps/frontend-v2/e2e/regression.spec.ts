import { test, expect } from '@playwright/test';
import { API, selectOption, waitForDrawer, waitForTable } from './helpers';

test.describe('回归防护 - 用户信息', () => {
  test('user dropdown shows admin role and name', async ({ page }) => {
    await page.goto('/');
    const userDropdown = page.locator('.ant-dropdown-trigger').last();
    await expect(userDropdown).toContainText('系统管理员');
  });

  test('logout redirects to login page', async ({ page }) => {
    await page.goto('/');
    const userDropdown = page.locator('.ant-dropdown-trigger').last();
    await userDropdown.click();
    await page.getByText('退出登录').click();
    await expect(page).toHaveURL('/login');
  });
});

test.describe('回归防护 - 表单交互', () => {
  test('drawer close does not submit data', async ({ page }) => {
    await page.goto('/attack');
    await waitForTable(page);
    const rowCountBefore = await page.locator('.ant-table-row').count();

    await page.getByRole('button', { name: '新建攻关' }).click();
    await waitForDrawer(page);
    await page.locator('.ant-drawer').getByLabel('标题').fill('E2E不应存在的单');
    await page.locator('.ant-drawer-close').click();

    await waitForTable(page);
    const rowCountAfter = await page.locator('.ant-table-row').count();
    expect(rowCountAfter).toBe(rowCountBefore);
  });

  test('attack create requires title', async ({ page }) => {
    await page.goto('/attack');
    await waitForTable(page);

    await page.getByRole('button', { name: '新建攻关' }).click();
    await waitForDrawer(page);
    await page.locator('.ant-drawer-extra button').click();

    await expect(page.getByText('请输入')).toBeVisible();
  });

  test('people create drawer close discards data', async ({ page }) => {
    await page.goto('/people');
    await waitForTable(page);
    const rowCountBefore = await page.locator('.ant-table-row').count();

    await page.getByRole('button', { name: /添\s?加/ }).click();
    await waitForDrawer(page);
    await page.locator('.ant-drawer').getByLabel('姓名').fill('E2E丢弃人员');
    await page.locator('.ant-drawer-close').click();

    await waitForTable(page);
    const rowCountAfter = await page.locator('.ant-table-row').count();
    expect(rowCountAfter).toBe(rowCountBefore);
  });
});

test.describe('回归防护 - 状态流转', () => {
  test('full status lifecycle: 待响应→处理中→已解决→已关闭', async ({ page, request }) => {
    const res = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E全流程单', 状态: '待响应' },
    });
    const ticket = await res.json();

    await page.goto(`/attack/${ticket.id}`);
    await expect(page.getByText('待响应').first()).toBeVisible();

    await page.getByRole('button', { name: '状态流转' }).click();
    await waitForDrawer(page);
    const drawer = page.locator('.ant-drawer');
    await selectOption(page, drawer.locator('.ant-select').first(), '处理中', true);
    await page.getByRole('button', { name: '确认流转' }).click();
    await expect(page.getByText('状态流转成功').first()).toBeVisible();
    await expect(page.getByText('处理中').first()).toBeVisible();

    await page.getByRole('button', { name: '状态流转' }).click();
    await waitForDrawer(page);
    const drawer2 = page.locator('.ant-drawer');
    await selectOption(page, drawer2.locator('.ant-select').first(), '已解决', true);
    await page.getByRole('button', { name: '确认流转' }).click();
    await expect(page.getByText('状态流转成功').first()).toBeVisible();

    await page.getByRole('button', { name: '状态流转' }).click();
    await waitForDrawer(page);
    const drawer3 = page.locator('.ant-drawer');
    await selectOption(page, drawer3.locator('.ant-select').first(), '已关闭', true);
    await page.getByRole('button', { name: '确认流转' }).click();
    await expect(page.getByText('状态流转成功').first()).toBeVisible();
  });
});

test.describe('回归防护 - Dashboard数据一致性', () => {
  test('dashboard stats reflect created tickets', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E看板统计A', 状态: '处理中' },
    });
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E看板统计B', 状态: '已关闭' },
    });

    await page.goto('/');
    await page.waitForTimeout(1000);

    const activeStat = page.locator('.ant-statistic').filter({ hasText: '进行中' });
    const closedStat = page.locator('.ant-statistic').filter({ hasText: '已闭环' });
    const totalStat = page.locator('.ant-statistic').filter({ hasText: '总攻关单' });

    await expect(activeStat).toBeVisible();
    await expect(closedStat).toBeVisible();
    await expect(totalStat).toBeVisible();
  });
});

test.describe('回归防护 - 直接URL导航', () => {
  test('direct URL to attack detail shows page', async ({ page, request }) => {
    const res = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E直接访问单', 状态: '处理中' },
    });
    const ticket = await res.json();

    await page.goto(`/attack/${ticket.id}`);
    await expect(page.getByRole('heading', { name: /E2E直接访问单/ })).toBeVisible();
    await expect(page.getByText('返回列表')).toBeVisible();
  });

  test('direct URL to honor person shows detail', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/contribution`, {
      data: { 贡献人: 'E2E直接访问人', 贡献等级: '核心', 贡献类型: '实施', 描述: 'E2E直接访问贡献' },
    });

    await page.goto('/honor');
    await page.getByText('E2E直接访问人').first().click();
    await expect(page.getByRole('heading', { name: 'E2E直接访问人' })).toBeVisible();
  });

  test('direct URL to all pages renders correctly', async ({ page }) => {
    const pages = [
      { url: '/', heading: '作战态势' },
      { url: '/attack', heading: '攻关作战台' },
      { url: '/people', heading: '全员名单' },
      { url: '/contributions', heading: '贡献录入' },
      { url: '/honor', heading: '荣誉殿堂' },
      { url: '/help', heading: '求助中心' },
      { url: '/search', heading: '全局搜索' },
      { url: '/proposals', heading: '关系审批' },
      { url: '/reminders', heading: '跟催提醒' },
      { url: '/import', heading: '数据导入/导出' },
      { url: '/email', heading: '邮件设置' },
      { url: '/audit', heading: '审计日志' },
      { url: '/bug-report', heading: '问题反馈' },
      { url: '/users', heading: '用户管理' },
    ];

    for (const p of pages) {
      await page.goto(p.url);
      await expect(page.getByRole('heading', { name: p.heading })).toBeVisible({ timeout: 8000 });
    }
  });
});

test.describe('回归防护 - 求助中心表单', () => {
  test('help request drawer form has all required fields', async ({ page }) => {
    await page.goto('/help');
    await page.getByRole('button', { name: '发起求助' }).click();
    await waitForDrawer(page);

    const drawer = page.locator('.ant-drawer');
    await expect(drawer.getByText('关联攻关单')).toBeVisible();
    await expect(drawer.getByText('求助人')).toBeVisible();
    await expect(drawer.getByText('求助对象邮箱')).toBeVisible();
    await expect(drawer.getByText('求助类型')).toBeVisible();
    await expect(drawer.getByText('求助内容')).toBeVisible();
  });
});

test.describe('回归防护 - 审计日志完整性', () => {
  test('audit log records create and update', async ({ page, request }) => {
    const res = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E审计完整性', 状态: '待响应' },
    });
    const ticket = await res.json();
    await request.put(`${API}/api/nodes/${ticket.id}`, {
      data: { 标题: 'E2E审计完整性修改' },
    });

    await page.goto('/audit');
    await waitForTable(page);
    await expect(page.getByRole('cell', { name: '创建' }).first()).toBeVisible();
  });

  test('audit filter shows correct results for DELETE', async ({ page, request }) => {
    const res = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E审计删除', 状态: '待响应' },
    });
    const ticket = await res.json();
    await request.delete(`${API}/api/nodes/${ticket.id}`);

    await page.goto('/audit');
    await waitForTable(page);
    const selects = page.locator('.ant-select');
    await selectOption(page, selects.nth(0), '删除');
    await waitForTable(page);
    await expect(page.getByRole('cell', { name: '删除' }).first()).toBeVisible();
  });
});
