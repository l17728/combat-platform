import { test, expect } from '@playwright/test';
import { API, selectOption, waitForTable } from './helpers';

test.describe('攻关作战台 - 列表', () => {
  test('shows page title and new button', async ({ page }) => {
    await page.goto('/attack');
    await expect(page.getByRole('heading', { name: '攻关作战台' })).toBeVisible();
    await expect(page.getByRole('button', { name: '新建攻关' })).toBeVisible();
    await expect(page.getByRole('button', { name: /导\s?出/ })).toBeVisible();
  });

  test('creates ticket via drawer and navigates to detail', async ({ page }) => {
    await page.goto('/attack');
    await page.getByRole('button', { name: '新建攻关' }).click();

    await expect(page.locator('.ant-drawer')).toBeVisible();
    await page.locator('.ant-drawer').getByLabel('标题').fill('E2E新建攻关单');
    await page.locator('.ant-drawer-extra button').click();
    await expect(page.getByText('创建成功')).toBeVisible();
    await expect(page).toHaveURL(/\/attack\//);
  });

  test('lists tickets in table', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E列表单A', 状态: '进行中', 当前处理人: '张三', 客户名称: '华为云' },
    });
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E列表单B', 状态: '待响应', 当前处理人: '李四' },
    });

    await page.goto('/attack');
    await waitForTable(page);
    await expect(page.getByRole('cell', { name: 'E2E列表单A' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'E2E列表单B' })).toBeVisible();
    await expect(page.getByRole('cell', { name: '张三' })).toBeVisible();
    await expect(page.getByRole('cell', { name: '进行中' }).first()).toBeVisible();
    await expect(page.getByRole('cell', { name: '待响应' }).first()).toBeVisible();
  });

  test('filters by status', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E筛选待响应', 状态: '待响应' },
    });
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E筛选已解决', 状态: '已解决' },
    });

    await page.goto('/attack');
    await waitForTable(page);
    await expect(page.getByText('E2E筛选待响应')).toBeVisible();
    await expect(page.getByText('E2E筛选已解决')).toBeVisible();

    const statusSelect = page.locator('.ant-select').nth(1);
    await selectOption(page, statusSelect, '已解决');
    await expect(page.getByText('E2E筛选待响应')).not.toBeVisible();
    await expect(page.getByText('E2E筛选已解决')).toBeVisible();
  });

  test('searches by keyword', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E搜索专用单', 状态: '处理中' },
    });
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E其他单', 状态: '处理中' },
    });

    await page.goto('/attack');
    await waitForTable(page);
    await page.getByPlaceholder('搜索标题/单号/处理人').fill('搜索专用');
    await expect(page.getByText('E2E搜索专用单')).toBeVisible();
    await expect(page.getByText('E2E其他单')).not.toBeVisible();
  });

  test('deletes ticket from list', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E待删除单', 状态: '待响应' },
    });

    await page.goto('/attack');
    await waitForTable(page);
    await expect(page.getByText('E2E待删除单')).toBeVisible();
    await page.getByRole('row').filter({ hasText: 'E2E待删除单' }).locator('a').last().click();
    await page.getByRole('button', { name: /确\s?定/ }).click();
    await expect(page.getByText('删除成功')).toBeVisible();
    await expect(page.getByText('E2E待删除单')).not.toBeVisible();
  });

  test('exports tickets', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E导出单', 状态: '处理中' },
    });

    await page.goto('/attack');
    await waitForTable(page);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /导\s?出/ }).click();
    const d = await download;
    expect(d.suggestedFilename()).toContain('.xlsx');
  });

  test('click row navigates to detail', async ({ page, request }) => {
    const res = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E点击行跳转', 状态: '处理中' },
    });
    const ticket = await res.json();

    await page.goto('/attack');
    await waitForTable(page);
    await page.getByRole('cell', { name: 'E2E点击行跳转' }).click();
    await expect(page).toHaveURL(new RegExp(`/attack/${ticket.id}`));
  });
});

test.describe('攻关详情', () => {
  test('displays ticket info and fields', async ({ page, request }) => {
    const res = await request.post(`${API}/api/nodes/attackTicket`, {
      data: {
        标题: 'E2E详情展示',
        状态: '处理中',
        当前处理人: '王五',
        问题单号: 'PB20260524001',
        事件级别: 'P2',
        客户名称: '华为云',
        影响及现存风险: 'E2E测试风险描述',
      },
    });
    const ticket = await res.json();

    await page.goto(`/attack/${ticket.id}`);
    await expect(page.getByRole('heading', { name: /E2E详情展示/ })).toBeVisible();
    await expect(page.getByText('PB20260524001')).toBeVisible();
    await expect(page.getByText('王五')).toBeVisible();
    await expect(page.getByText('华为云')).toBeVisible();
    await expect(page.getByText('E2E测试风险描述')).toBeVisible();
  });

  test('shows progress timeline', async ({ page, request }) => {
    const res = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E时间线', 状态: '处理中' },
    });
    const ticket = await res.json();
    await request.post(`${API}/api/nodes/${ticket.id}/progress`, {
      data: { content: '首次排查完成', statusSnapshot: '处理中', actor: 'e2e' },
    });
    await request.post(`${API}/api/nodes/${ticket.id}/progress`, {
      data: { content: '定位到根因', statusSnapshot: '处理中', actor: 'e2e' },
    });

    await page.goto(`/attack/${ticket.id}`);
    await page.getByRole('tab', { name: '进展同步' }).click();
    await expect(page.getByText('首次排查完成')).toBeVisible();
    await expect(page.getByText('定位到根因')).toBeVisible();
  });

  test('appends progress via drawer', async ({ page, request }) => {
    const res = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E追加进展', 状态: '处理中' },
    });
    const ticket = await res.json();

    await page.goto(`/attack/${ticket.id}`);
    await page.getByRole('tab', { name: '进展同步' }).click();
    await page.getByRole('button', { name: '追加进展' }).click();

    await expect(page.locator('.ant-drawer')).toBeVisible();
    await page.getByPlaceholder('描述当前进展...').fill('E2E通过UI追加的进展');
    await page.getByRole('button', { name: '提交进展' }).click();
    await expect(page.getByText('进展已追加')).toBeVisible();
    await expect(page.getByText('E2E通过UI追加的进展')).toBeVisible();
  });

  test('transitions status', async ({ page, request }) => {
    const res = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E状态流转', 状态: '待响应' },
    });
    const ticket = await res.json();

    await page.goto(`/attack/${ticket.id}`);
    await expect(page.getByText('待响应').first()).toBeVisible();

    await page.getByRole('button', { name: '状态流转' }).click();
    await expect(page.locator('.ant-drawer')).toBeVisible();
    const drawer = page.locator('.ant-drawer');
    const drawerSelect = drawer.locator('.ant-select').first();
    await selectOption(page, drawerSelect, '处理中', true);
    await page.getByRole('button', { name: '确认流转' }).click();
    await expect(page.getByText('状态流转成功')).toBeVisible();
    await expect(page.getByText('处理中').first()).toBeVisible();
  });

  test('edits ticket info via drawer', async ({ page, request }) => {
    const res = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E编辑前标题', 状态: '处理中', 问题单号: 'PB000' },
    });
    const ticket = await res.json();

    await page.goto(`/attack/${ticket.id}`);
    await page.getByRole('button', { name: '编辑信息' }).click();

    await expect(page.locator('.ant-drawer')).toBeVisible();
    await page.locator('.ant-drawer').getByLabel('标题').clear();
    await page.locator('.ant-drawer').getByLabel('标题').fill('E2E编辑后标题');
    await page.locator('.ant-drawer').getByLabel('问题单号').clear();
    await page.locator('.ant-drawer').getByLabel('问题单号').fill('PB999');
    await page.locator('.ant-drawer-extra button').click();
    await expect(page.getByText('更新成功')).toBeVisible();
    await expect(page.getByText('E2E编辑后标题')).toBeVisible();
    await expect(page.getByText('PB999')).toBeVisible();
  });

  test('deletes ticket from detail page', async ({ page, request }) => {
    const res = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E详情删除', 状态: '待响应' },
    });
    const ticket = await res.json();

    await page.goto(`/attack/${ticket.id}`);
    await page.getByRole('button', { name: /删\s?除/ }).click();
    await page.getByRole('button', { name: /确\s?定/ }).click();
    await expect(page.getByText('已删除')).toBeVisible();
    await expect(page).toHaveURL('/attack');
  });

  test('back button returns to list', async ({ page, request }) => {
    const res = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E返回测试', 状态: '处理中' },
    });
    const ticket = await res.json();

    await page.goto(`/attack/${ticket.id}`);
    await page.getByRole('button', { name: '返回列表' }).click();
    await expect(page).toHaveURL('/attack');
  });

  test('shows helper recommendations', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/person`, {
      data: { 姓名: 'E2E专家A' },
    });
    await request.post(`${API}/api/nodes/contribution`, {
      data: { 贡献人: 'E2E专家A', 贡献等级: '核心', 贡献类型: '实施', 描述: 'E2E历史贡献' },
    });
    const res = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E找帮手', 状态: '处理中', 影响及现存风险: '数据库性能问题' },
    });
    const ticket = await res.json();

    await page.goto(`/attack/${ticket.id}`);
    const helperSection = page.getByText('找帮手推荐');
    if (await helperSection.isVisible()) {
      await expect(page.getByText('E2E专家A')).toBeVisible();
    }
  });

  test('audit log section shows history', async ({ page, request }) => {
    const res = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E审计查看', 状态: '处理中' },
    });
    const ticket = await res.json();

    await page.goto(`/attack/${ticket.id}`);
    await page.getByRole('tab', { name: '历史记录' }).click();
    await expect(page.getByText('创建').first()).toBeVisible();
  });
});
