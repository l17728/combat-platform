import { test, expect } from '@playwright/test';

const API = 'http://localhost:3001';

test.describe('求助中心', () => {
  test('shows page heading and create button', async ({ page }) => {
    await page.goto('/help');
    await expect(page.getByRole('heading', { name: '求助中心' })).toBeVisible();
    await expect(page.getByRole('button', { name: '发起求助' })).toBeVisible();
  });

  test('shows empty state', async ({ page }) => {
    await page.goto('/help');
    await expect(page.getByText('暂无求助记录')).toBeVisible();
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
    await expect(page.locator('.ant-drawer-content')).toBeVisible();

    await page.locator('.ant-drawer-content').getByPlaceholder('搜索攻关单').click();
    await page.getByRole('option', { name: /E2E求助关联单/ }).click();

    await page.locator('.ant-drawer-content').getByPlaceholder('您的姓名').click();
    await page.getByRole('option', { name: /E2E求助人/ }).click();

    await page.locator('.ant-drawer-content').getByPlaceholder('email@example.com').fill('target@test.com');

    await page.locator('.ant-drawer-content').getByText('环境').click();

    await page.locator('.ant-drawer-content').getByPlaceholder('请描述您需要帮助的内容...').fill('E2E求助内容测试');

    await page.locator('.ant-drawer-extra').getByRole('button', { name: '发送求助邮件' }).click();

    await expect(page.getByText('求助已发送')).toBeVisible();
  });

  test('filters by status', async ({ page }) => {
    await page.goto('/help');
    await page.locator('.ant-select').first().click();
    await page.getByRole('option', { name: '待回复' }).click();
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
    const select = page.locator('.ant-select').first();
    await select.click();
    await page.getByRole('option', { name: '人员' }).click();
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
    await expect(page.getByRole('cell', { name: 'create' }).first()).toBeVisible();
    await expect(page.getByRole('cell', { name: 'attackTicket' }).first()).toBeVisible();
  });

  test('filters by action type', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E审计筛选单', 状态: '处理中' },
    });

    await page.goto('/audit');
    const selects = page.locator('.ant-select');
    await selects.first().click();
    await page.getByRole('option', { name: 'create' }).click();
    await expect(page.getByRole('cell', { name: 'create' }).first()).toBeVisible();
  });

  test('filters by entity type', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/person`, {
      data: { 姓名: 'E2E审计人' },
    });

    await page.goto('/audit');
    const selects = page.locator('.ant-select');
    await selects.nth(1).click();
    await page.getByRole('option', { name: 'person' }).click();
    await expect(page.getByRole('cell', { name: 'person' }).first()).toBeVisible();
  });
});

test.describe('导航与布局', () => {
  test('sidebar navigation works', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '作战态势' })).toBeVisible();

    await page.getByText('攻关管理').click();
    await page.getByText('攻关作战台').click();
    await expect(page).toHaveURL('/attack');
    await expect(page.getByRole('heading', { name: '攻关作战台' })).toBeVisible();

    await page.getByText('人员与荣誉').click();
    await page.getByText('全员名单').click();
    await expect(page).toHaveURL('/people');
    await expect(page.getByRole('heading', { name: '全员名单' })).toBeVisible();

    await page.getByText('贡献录入').click();
    await expect(page).toHaveURL('/contributions');
    await expect(page.getByRole('heading', { name: '贡献录入' })).toBeVisible();

    await page.getByText('荣誉殿堂').click();
    await expect(page).toHaveURL('/honor');
    await expect(page.getByRole('heading', { name: '荣誉殿堂' })).toBeVisible();

    await page.getByText('求助中心').click();
    await expect(page).toHaveURL('/help');
    await expect(page.getByRole('heading', { name: '求助中心' })).toBeVisible();
  });

  test('sidebar collapse toggle works', async ({ page }) => {
    await page.goto('/');
    const sider = page.locator('.ant-layout-sider');
    await expect(sider).toBeVisible();

    await page.locator('.ant-layout-sider-trigger').click();
    await expect(sider).toBeVisible();
  });

  test('role switcher is present in header', async ({ page }) => {
    await page.goto('/');
    const roleSelector = page.locator('.ant-header .ant-select');
    await expect(roleSelector).toBeVisible();
  });

  test('navigates to system management subpages', async ({ page }) => {
    await page.goto('/');

    await page.getByText('数据导入/导出').click();
    await expect(page).toHaveURL('/import');

    await page.getByText('邮件设置').click();
    await expect(page).toHaveURL('/email');

    await page.getByText('审计日志').click();
    await expect(page).toHaveURL('/audit');
  });

  test('logo link navigates to dashboard', async ({ page }) => {
    await page.goto('/attack');
    await page.getByText('作战平台').click();
    await expect(page).toHaveURL('/');
  });
});
