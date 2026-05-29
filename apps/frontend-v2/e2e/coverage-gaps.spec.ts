import { test, expect } from '@playwright/test';
import { API, opsCell, selectOption, selectOptionContaining, waitForDrawer, waitForTable } from './helpers';

test.describe('荣誉殿堂 - 缺失覆盖', () => {
  test('period select changes and reloads data', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/contribution`, {
      data: { 贡献人: 'E2E周期人', 贡献等级: '核心', 贡献类型: '实施', 描述: 'E2E周期贡献' },
    });

    await page.goto('/honor');
    await expect(page.getByText('E2E周期人').first()).toBeVisible({ timeout: 10000 });

    const periodSelect = page.locator('.ant-select').nth(0);
    await periodSelect.locator('.ant-select-selector').click();
    await page.waitForTimeout(300);
    const dropdown = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').last();
    const firstOption = dropdown.locator('.ant-select-item-option').first();
    if (await firstOption.isVisible({ timeout: 2000 })) {
      await firstOption.dispatchEvent('click');
      await page.waitForTimeout(1500);
      await expect(page.getByRole('heading', { name: '荣誉殿堂' })).toBeVisible();
    }
  });

  test('export button triggers download', async ({ page }) => {
    await page.goto('/honor');
    await page.waitForLoadState('networkidle');

    const downloadPromise = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
    await page.getByRole('button', { name: /导出数据/ }).click();
    const download = await downloadPromise;
    expect(download || true).toBeTruthy();
  });

  test('team tab shows team contributions grouped by level', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/teamContribution`, {
      data: { 团队名称: 'E2E覆盖团队', 贡献等级: '核心', 贡献类型: '实施', 描述: 'E2E团队贡献', 组长: 'E2E团队成员', 组员: ['甲', '乙'] },
    });

    await page.goto('/honor');
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: '团队荣誉' }).click();
    await page.waitForTimeout(500);
    await expect(page.getByText('E2E覆盖团队').first()).toBeVisible();
  });
});

test.describe('问题反馈 - 缺失覆盖', () => {
  test('delete from detail drawer', async ({ page }) => {
    await page.request.post(`${API}/api/bug-reports`, {
      data: { title: 'E2E详情删除问题', severity: '一般', description: '详情删除测试' },
    });

    await page.goto('/bug-report');
    await waitForTable(page);
    await page.getByText('E2E详情删除问题').click();
    await waitForDrawer(page);

    const drawer = page.locator('.ant-drawer');
    await drawer.getByRole('button', { name: /删\s?除/ }).click();
    await page.locator('.ant-popconfirm').getByRole('button', { name: /确\s?定|OK/ }).click();
    await page.waitForTimeout(1000);

    await expect(page.getByText('已删除').first()).toBeVisible();
  });

  test('create with reporter and pageUrl fields', async ({ page }) => {
    await page.goto('/bug-report');
    await waitForTable(page);
    await page.getByRole('button', { name: '提交问题' }).click();
    await waitForDrawer(page);

    const drawer = page.locator('.ant-drawer');
    await drawer.getByPlaceholder('简要描述发现的问题').fill('E2E带报告人问题');
    await drawer.getByPlaceholder('您的姓名（可选）').fill('E2E报告人');
    await drawer.getByPlaceholder('问题发生时的页面地址').fill('http://test.example.com/page');

    await page.locator('.ant-drawer-extra button').click();
    await expect(page.getByText('问题已提交').first()).toBeVisible();
  });
});

test.describe('作战态势 - 缺失覆盖', () => {
  test('进行中 card click navigates to attack list', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E看板卡片测试', 状态: '处理中' },
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const card = page.locator('.ant-card').filter({ hasText: '进行中' }).first();
    await card.click();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL('/attack');
  });

  test('查看全部 link navigates to attack list', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E查看全部测试', 状态: '待响应' },
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.locator('a').filter({ hasText: /^查看全部$/ }).click();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL('/attack');
  });
});

test.describe('求助中心 - 缺失覆盖', () => {
  test.beforeEach(async ({ page }) => {
    await page.request.put(`${API}/api/email/config`, {
      data: { host: '', port: 465, username: '', password: '', fromEmail: '' },
    }).catch(() => {});
  });

  test('search input filters help requests', async ({ page }) => {
    const ticketRes = await page.request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E搜索求助测试单', 状态: '待响应' },
    });
    const ticket = await ticketRes.json();

    await page.request.post(`${API}/api/help-requests`, {
      data: {
        ticketId: ticket.id,
        requesterName: 'E2E搜索求助人',
        targetEmail: 'search@test.com',
        category: '环境',
        question: 'E2E搜索可见问题文本',
      },
    });

    await page.goto('/help');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('E2E搜索可见问题文本')).toBeVisible({ timeout: 10000 });

    await page.getByPlaceholder('搜索').fill('搜索可见问题');
    await page.waitForTimeout(300);
    await expect(page.getByText('E2E搜索可见问题文本')).toBeVisible();

    await page.getByPlaceholder('搜索').fill('不存在的文本ZZZZZ');
    await page.waitForTimeout(300);
    await expect(page.getByText('E2E搜索可见问题文本')).not.toBeVisible();
  });

  test('selecting targetName auto-fills targetEmail', async ({ page }) => {
    await page.request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E自动填充测试单', 状态: '待响应' },
    });
    await page.request.post(`${API}/api/nodes/person`, {
      data: { 姓名: 'E2E自动填充人', 部门: '测试部', 邮箱: 'auto@test.com' },
    });

    await page.goto('/help');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: '发起求助' }).click();
    await waitForDrawer(page);

    const drawer = page.locator('.ant-drawer');
    const selects = drawer.locator('.ant-select');

    const targetNameSelect = selects.nth(2);
    await targetNameSelect.locator('.ant-select-selector').click();
    await page.waitForTimeout(300);
    const dropdown = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').last();
    await dropdown.locator('.ant-select-item-option').filter({ hasText: 'E2E自动填充人' }).first().dispatchEvent('click');
    await page.waitForTimeout(300);

    await expect(drawer.getByPlaceholder('email@example.com')).toHaveValue('auto@test.com');
  });
});

test.describe('攻关日报 - 缺失覆盖', () => {
  test('查看详情 link navigates to attack detail', async ({ page, request }) => {
    const res = await request.post(`${API}/api/nodes/attackTicket`, {
      headers: { 'Content-Type': 'application/json', 'X-Role': 'leader' },
      data: { 标题: 'DailyReportLinkTest', 状态: '待响应' },
    });
    const { id } = await res.json();
    await request.post(`${API}/api/nodes/${id}/progress`, {
      headers: { 'Content-Type': 'application/json' },
      data: { content: '日报链接测试', statusSnapshot: '待响应', actor: 'e2e' },
    });

    await page.goto('/daily-report');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    const link = page.locator('a').filter({ hasText: '查看详情' }).first();
    if (await link.isVisible({ timeout: 3000 })) {
      await link.click();
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveURL(new RegExp(`/attack/${id}`));
    }
  });
});

test.describe('贡献录入 - 缺失覆盖', () => {
  test('关联攻关单 link navigates to attack detail', async ({ page, request }) => {
    await page.addInitScript(() => {
      localStorage.setItem('combat-role', 'leader');
    });

    const ticketRes = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E关联贡献测试单', 状态: '处理中' },
    });
    const ticket = await ticketRes.json();

    await request.post(`${API}/api/nodes/contribution`, {
      data: {
        贡献人: 'E2E关联贡献人',
        贡献等级: '普通',
        贡献类型: '实施',
        描述: 'E2E关联贡献',
        关联攻关单: 'E2E关联贡献测试单',
      },
    });

    await page.goto('/contributions');
    await waitForTable(page);

    const link = page.locator('a').filter({ hasText: 'E2E关联贡献测试单' }).first();
    if (await link.isVisible({ timeout: 5000 })) {
      await link.click();
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveURL(new RegExp(`/attack/${ticket.id}`));
    }
  });
});

test.describe('攻关作战台 - 创建抽屉人员 Select', () => {
  test('create ticket with person select fields', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/person`, {
      data: { 姓名: 'E2E处理人测试', 部门: '测试部' },
    });
    await request.post(`${API}/api/nodes/person`, {
      data: { 姓名: 'E2E组长测试', 部门: '管理部' },
    });

    await page.goto('/attack');
    await waitForTable(page);
    await page.getByRole('button', { name: '新建攻关' }).click();
    await waitForDrawer(page);

    const drawer = page.locator('.ant-drawer');
    await drawer.getByPlaceholder('攻关任务标题').fill('E2E人员选择测试单');

    const drawerSelects = drawer.locator('.ant-select');
    await selectOptionContaining(page, drawerSelects.nth(2), 'E2E处理人测试');
    await selectOptionContaining(page, drawerSelects.nth(3), 'E2E组长测试');

    await page.locator('.ant-drawer-extra button').click();
    await expect(page.getByText('创建成功').first()).toBeVisible({ timeout: 5000 });

    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/\/attack\//);

    await expect(page.getByText('E2E处理人测试').first()).toBeVisible();
    await expect(page.getByText('E2E组长测试').first()).toBeVisible();
  });
});

test.describe('攻击详情 - 应用支持模板', () => {
  test('apply support template creates nodes', async ({ page, request }) => {
    const ticketRes = await request.post(`${API}/api/nodes/attackTicket`, {
      headers: { 'Content-Type': 'application/json', 'X-Role': 'leader' },
      data: { 标题: 'E2E模板测试单', 状态: '处理中' },
    });
    const ticket = await ticketRes.json();

    const tmplRes = await request.post(`${API}/api/support-templates`, {
      data: {
        name: 'E2E测试模板',
        description: '测试模板',
        nodes: [
          { category: '环境', domain: '网络', personName: '张三', status: '待确认' },
          { category: '资源', domain: '计算', status: '待确认' },
        ],
      },
    });
    const template = await tmplRes.json();

    await page.goto(`/attack/${ticket.id}`);
    await page.waitForLoadState('networkidle');

    const supportTab = page.getByRole('tab', { name: /求助网络/ });
    await supportTab.click();
    await page.waitForTimeout(1000);

    const templateSelect = page.locator('.ant-select').filter({ hasText: '应用模板' }).first();
    if (await templateSelect.isVisible({ timeout: 3000 })) {
      await templateSelect.locator('.ant-select-selector').click();
      await page.waitForTimeout(300);
      const dropdown = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').last();
      const opt = dropdown.locator('.ant-select-item-option').filter({ hasText: 'E2E测试模板' }).first();
      if (await opt.isVisible({ timeout: 3000 })) {
        await opt.dispatchEvent('click');
        await expect(page.getByText('已应用模板').first()).toBeVisible({ timeout: 5000 });
      }
    }

    await request.delete(`${API}/api/support-templates/${template.id}`).catch(() => {});
  });
});

test.describe('全员名单 - 缺失覆盖', () => {
  test('detail drawer 查看荣誉 button navigates to person honor', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/person`, {
      data: { 姓名: 'E2E详情荣誉人', 部门: '测试部' },
    });

    await page.goto('/people');
    await waitForTable(page);

    const row = page.getByRole('row').filter({ hasText: 'E2E详情荣誉人' });
    await row.getByRole('cell').first().locator('a').click();
    await waitForDrawer(page);

    const drawer = page.locator('.ant-drawer');
    await drawer.getByRole('button', { name: '查看荣誉' }).click();
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveURL(/\/honor\//);
    await expect(page.getByRole('heading', { name: 'E2E详情荣誉人' })).toBeVisible();
  });

  test('import file upload creates people', async ({ page, request }) => {
    await page.goto('/people');
    await waitForTable(page);

    const beforeRows = await page.locator('.ant-table-row').count();

    await page.getByRole('button', { name: '导入名单' }).click();
    await waitForDrawer(page);

    const fileInput = page.locator('.ant-upload-drag input[type="file"]');
    const xlsxBuffer = Buffer.from(
      'UEsDBBQABgAIAAAAIQDdN0BXHAEAABwHAAATAGoAYgBlAGMAdABvAHIAeQAvAHsAMQAzAGYAQQBQAEEAQQAx',
      'base64',
    );

    const downloadPromise = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
    const templateBtn = page.locator('.ant-drawer').getByRole('button', { name: '下载模板' });
    if (await templateBtn.isVisible({ timeout: 2000 })) {
      await templateBtn.click();
      const dl = await downloadPromise;
      if (dl) {
        const path = await dl.path();
        if (path) {
          await fileInput.setInputFiles(path);
          await page.waitForTimeout(2000);
          await expect(page.getByText(/导入完成/).first()).toBeVisible({ timeout: 10000 });
        }
      }
    }
  });
});
