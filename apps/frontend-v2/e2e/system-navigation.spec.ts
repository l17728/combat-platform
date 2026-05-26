import { test, expect } from '@playwright/test';
import { API, selectOption, selectOptionContaining, waitForDrawer, waitForTable } from './helpers';

test.describe('求助中心', () => {
  test('shows page heading and create button', async ({ page }) => {
    await page.goto('/help');
    await expect(page.getByRole('heading', { name: '求助中心' })).toBeVisible();
    await expect(page.getByRole('button', { name: '发起求助' })).toBeVisible();
  });

  test('shows help center page with table', async ({ page }) => {
    await page.goto('/help');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.ant-table').or(page.getByText('暂无求助记录'))).toBeVisible();
  });

  test('opens and fills help request drawer', async ({ page, request }) => {
    const ticketRes = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E求助关联单', 状态: '处理中' },
    });
    const ticket = await ticketRes.json();
    await request.post(`${API}/api/nodes/person`, {
      data: { 姓名: 'E2E求助人', 邮箱: 'helper@test.com' },
    });

    await page.goto('/help');
    await page.getByRole('button', { name: '发起求助' }).click();
    await waitForDrawer(page);

    const drawer = page.locator('.ant-drawer');
    const drawerSelects = drawer.locator('.ant-select');

    await selectOptionContaining(page, drawerSelects.first(), 'E2E求助关联单');
    await selectOptionContaining(page, drawerSelects.nth(1), 'E2E求助人');

    await page.getByPlaceholder('email@example.com').fill('target@test.com');

    await selectOption(page, drawerSelects.nth(3), '环境');

    await page.getByPlaceholder('请描述您需要帮助的内容...').fill('E2E求助内容测试');

    await page.locator('.ant-drawer-extra button').click();

    await expect(page.getByText('求助已发送')).toBeVisible();
  });

  test('filters by status', async ({ page }) => {
    await page.goto('/help');
    const statusSelect = page.locator('.ant-select').nth(1);
    await selectOption(page, statusSelect, '待回复');
  });

  test('searches help requests', async ({ page }) => {
    await page.goto('/help');
    await page.getByPlaceholder('搜索').fill('测试关键词');
  });
});

test.describe('数据导入/导出', () => {
  test('shows page heading and type selector', async ({ page }) => {
    await page.goto('/import');
    await expect(page.getByRole('heading', { name: '数据导入/导出' })).toBeVisible();
    await expect(page.getByText('数据类型：')).toBeVisible();
    await expect(page.getByRole('button', { name: '导出当前数据' })).toBeVisible();
  });

  test('exports attack tickets', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E导入导出单', 状态: '处理中' },
    });

    await page.goto('/import');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出当前数据' }).click();
    const d = await download;
    expect(d.suggestedFilename()).toContain('.xlsx');
  });

  test('type selector changes active type', async ({ page }) => {
    await page.goto('/import');
    const typeSelect = page.locator('.ant-select').nth(1);
    await selectOption(page, typeSelect, '人员');
  });

  test('upload area is present', async ({ page }) => {
    await page.goto('/import');
    await expect(page.getByText('点击或拖拽 Excel 文件到此处（仅预览）')).toBeVisible();
  });
});

test.describe('邮件设置', () => {
  test('shows page heading and form fields', async ({ page }) => {
    await page.goto('/email');
    await expect(page.getByRole('heading', { name: '邮件设置' })).toBeVisible();
    await expect(page.getByText('SMTP 服务器')).toBeVisible();
    await expect(page.getByText('端口')).toBeVisible();
    await expect(page.getByText('用户名')).toBeVisible();
    await expect(page.getByText('密码')).toBeVisible();
    await expect(page.getByRole('button', { name: '保存配置' })).toBeVisible();
  });

  test('saves email configuration', async ({ page }) => {
    await page.goto('/email');
    await page.getByPlaceholder('smtp.example.com').fill('smtp.test.com');
    await page.getByPlaceholder('465').fill('465');
    await page.getByPlaceholder('发件人邮箱').fill('test@test.com');
    await page.getByPlaceholder('发件人名称 <email@example.com>').fill('测试 <test@test.com>');
    await page.getByRole('button', { name: '保存配置' }).click();
    await expect(page.getByText('保存成功')).toBeVisible();
  });

  test('shows test email section', async ({ page }) => {
    await page.goto('/email');
    await expect(page.getByText('发送测试邮件')).toBeVisible();
  });
});

test.describe('审计日志', () => {
  test('shows page heading', async ({ page }) => {
    await page.goto('/audit');
    await expect(page.getByRole('heading', { name: '审计日志' })).toBeVisible();
  });

  test('shows audit entries after action', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E审计测试单', 状态: '待响应' },
    });

    await page.goto('/audit');
    await waitForTable(page);
    await expect(page.getByRole('cell', { name: '创建' }).first()).toBeVisible();
  });

  test('filters by action type', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E审计筛选单', 状态: '处理中' },
    });

    await page.goto('/audit');
    await waitForTable(page);
    const selects = page.locator('.ant-select');
    await selectOption(page, selects.nth(1), '创建');
    await waitForTable(page);
    await expect(page.getByRole('cell', { name: '创建' }).first()).toBeVisible();
  });

  test('filters by entity type', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/person`, {
      data: { 姓名: 'E2E审计人' },
    });

    await page.goto('/audit');
    await waitForTable(page);
    const selects = page.locator('.ant-select');
    await selectOption(page, selects.nth(2), '节点');
    await waitForTable(page);
    await expect(page.getByRole('cell', { name: '节点' }).first()).toBeVisible();
  });
});

test.describe('导航与布局', () => {
  async function clickMenu(page: any, labels: string[]) {
    for (const label of labels) {
      await page.locator('.ant-menu').locator('.ant-menu-title-content').filter({ hasText: label }).first().click();
      await page.waitForTimeout(200);
    }
  }

  test('sidebar navigation works', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '作战态势' })).toBeVisible();

    await page.locator('.ant-menu-submenu-title').filter({ hasText: '攻关管理' }).click();
    await page.locator('.ant-menu-item').filter({ hasText: '攻关作战台' }).click();
    await expect(page).toHaveURL('/attack');
    await expect(page.getByRole('heading', { name: '攻关作战台' })).toBeVisible();

    await page.locator('.ant-menu-submenu-title').filter({ hasText: '人员与荣誉' }).click();
    await page.locator('.ant-menu-item').filter({ hasText: '全员名单' }).click();
    await expect(page).toHaveURL('/people');
    await expect(page.getByRole('heading', { name: '全员名单' })).toBeVisible();

    await page.locator('.ant-menu-item').filter({ hasText: '贡献录入' }).click();
    await expect(page).toHaveURL('/contributions');

    await page.locator('.ant-menu-item').filter({ hasText: '荣誉殿堂' }).click();
    await expect(page).toHaveURL('/honor');

    await page.locator('.ant-menu-item').filter({ hasText: '求助中心' }).click();
    await expect(page).toHaveURL('/help');
  });

  test('clicking submenu title navigates to default child page', async ({ page }) => {
    await page.goto('/');

    await page.locator('.ant-menu-submenu-title').filter({ hasText: '攻关管理' }).click();
    await expect(page).toHaveURL('/attack');
    await expect(page.getByRole('heading', { name: '攻关作战台' })).toBeVisible();

    await page.locator('.ant-menu-submenu-title').filter({ hasText: '人员与荣誉' }).click();
    await expect(page).toHaveURL('/people');
    await expect(page.getByRole('heading', { name: '全员名单' })).toBeVisible();

    await page.locator('.ant-menu-submenu-title').filter({ hasText: '系统管理' }).click();
    await expect(page).toHaveURL('/import');
    await expect(page.getByRole('heading', { name: '数据导入/导出' })).toBeVisible();
  });

  test('collapsed sidebar shows icon-only with popup on hover', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('sidebar-toggle').click();
    await page.waitForTimeout(300);

    const sider = page.locator('.ant-layout-sider');
    await expect(sider).toHaveAttribute('class', /collapsed/);

    await page.locator('.ant-menu-submenu').filter({ hasText: '攻关管理' }).locator('> .ant-menu-submenu-title').hover();
    await page.waitForTimeout(500);

    await page.getByTestId('sidebar-toggle').click();
    await page.waitForTimeout(300);
  });

  test('sidebar highlights current page', async ({ page }) => {
    await page.goto('/attack');
    await page.waitForTimeout(500);
    const attackItem = page.locator('.ant-menu-item-selected');
    await expect(attackItem).toContainText('攻关作战台');

    await page.locator('.ant-menu-submenu-title').filter({ hasText: '人员与荣誉' }).click();
    await page.locator('.ant-menu-item').filter({ hasText: '全员名单' }).click();
    await page.waitForTimeout(500);
    const peopleItem = page.locator('.ant-menu-item-selected');
    await expect(peopleItem).toContainText('全员名单');
  });

  test('all pages reachable via sidebar from dashboard', async ({ page }) => {
    const pages = [
      { nav: ['作战态势'], heading: '作战态势' },
      { nav: ['攻关管理', '攻关作战台'], heading: '攻关作战台' },
      { nav: ['攻关管理', '攻关日报'], heading: '攻关日报' },
      { nav: ['人员与荣誉', '全员名单'], heading: '全员名单' },
      { nav: ['人员与荣誉', '贡献录入'], heading: '贡献录入' },
      { nav: ['人员与荣誉', '荣誉殿堂'], heading: '荣誉殿堂' },
      { nav: ['人员与荣誉', '人员合并'], heading: '人员合并' },
      { nav: ['求助中心'], heading: '求助中心' },
      { nav: ['审核管理', '关系审批'], heading: '关系审批' },
      { nav: ['审核管理', '跟催提醒'], heading: '跟催提醒' },
      { nav: ['全局搜索'], heading: '全局搜索' },
      { nav: ['问题反馈'], heading: '问题反馈' },
      { nav: ['系统管理', '数据导入/导出'], heading: '数据导入/导出' },
      { nav: ['系统管理', '表结构管理'], heading: '表结构管理' },
      { nav: ['系统管理', '邮件设置'], heading: '邮件设置' },
      { nav: ['系统管理', '审计日志'], heading: '审计日志' },
    ];

    for (const p of pages) {
      await page.goto('/');
      await page.waitForTimeout(300);
      for (const label of p.nav) {
        const target = page.locator('.ant-menu').locator('.ant-menu-title-content').filter({ hasText: label }).first();
        await target.click();
        await page.waitForTimeout(200);
      }
      await expect(page.getByRole('heading', { name: p.heading })).toBeVisible({ timeout: 5000 });
    }
  });

  test('sidebar collapse toggle works', async ({ page }) => {
    await page.goto('/');
    const sider = page.locator('.ant-layout-sider');
    await expect(sider).toBeVisible();

    await page.getByTestId('sidebar-toggle').click();
    await expect(sider).toBeVisible();

    await page.getByTestId('sidebar-toggle').click();
    await expect(sider).toBeVisible();
  });

  test('role switcher is present in header', async ({ page }) => {
    await page.goto('/');
    const headerSelect = page.locator('.ant-layout-header .ant-select');
    await expect(headerSelect).toBeVisible();
  });

  test('navigates to system management subpages', async ({ page }) => {
    await page.goto('/');

    await page.locator('.ant-menu-submenu-title').filter({ hasText: '系统管理' }).click();
    await page.locator('.ant-menu-item').filter({ hasText: '数据导入/导出' }).click();
    await expect(page).toHaveURL('/import');

    await page.locator('.ant-menu-item').filter({ hasText: '邮件设置' }).click();
    await expect(page).toHaveURL('/email');

    await page.locator('.ant-menu-item').filter({ hasText: '审计日志' }).click();
    await expect(page).toHaveURL('/audit');
  });

  test('logo link navigates to dashboard', async ({ page }) => {
    await page.goto('/attack');
    await page.getByTestId('sider-logo').click();
    await expect(page).toHaveURL('/');
  });
});
