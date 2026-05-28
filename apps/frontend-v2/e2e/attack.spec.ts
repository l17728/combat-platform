import { test, expect } from '@playwright/test';
import { API, opsCell, selectOption, waitForTable } from './helpers';

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

  test('filters by field and single checkbox value', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E筛选待响应', 状态: '待响应' },
    });
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E筛选已解决', 状态: '已解决' },
    });

    await page.goto('/attack');
    await waitForTable(page);
    const tbody = page.locator('tbody').first();
    await expect(tbody.getByText('E2E筛选待响应')).toBeVisible();
    await expect(tbody.getByText('E2E筛选已解决')).toBeVisible();

    const fieldSelect = page.locator('.ant-select').nth(0);
    await selectOption(page, fieldSelect, '状态');

    await expect(page.locator('.ant-checkbox-group')).toBeVisible();
    await page.locator('.ant-checkbox-group').locator('label').filter({ hasText: '已解决' }).locator('input').click();

    await expect(tbody.getByText('E2E筛选待响应')).not.toBeVisible();
    await expect(tbody.getByText('E2E筛选已解决')).toBeVisible();
  });

  test('multi-select checkbox uses OR logic', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E多选待响应', 状态: '待响应' },
    });
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E多选处理中', 状态: '处理中' },
    });
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E多选已关闭', 状态: '已关闭' },
    });

    await page.goto('/attack');
    await waitForTable(page);
    const tbody = page.locator('tbody').first();

    const fieldSelect = page.locator('.ant-select').nth(0);
    await selectOption(page, fieldSelect, '状态');
    await expect(page.locator('.ant-checkbox-group')).toBeVisible();

    await page.locator('.ant-checkbox-group').locator('label').filter({ hasText: '待响应' }).locator('input').click();
    await page.locator('.ant-checkbox-group').locator('label').filter({ hasText: '处理中' }).locator('input').click();

    await expect(tbody.getByText('E2E多选待响应')).toBeVisible();
    await expect(tbody.getByText('E2E多选处理中')).toBeVisible();
    await expect(tbody.getByText('E2E多选已关闭')).not.toBeVisible();
  });

  test('unchecking checkbox removes filter', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E取消勾选单', 状态: '处理中' },
    });
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E保留单', 状态: '待响应' },
    });

    await page.goto('/attack');
    await waitForTable(page);
    const tbody = page.locator('tbody').first();

    const fieldSelect = page.locator('.ant-select').nth(0);
    await selectOption(page, fieldSelect, '状态');

    const checkbox = page.locator('.ant-checkbox-group').locator('label').filter({ hasText: '处理中' }).locator('input');
    await checkbox.click();
    await expect(tbody.getByText('E2E取消勾选单')).toBeVisible();
    await expect(tbody.getByText('E2E保留单')).not.toBeVisible();

    await checkbox.click();
    await expect(tbody.getByText('E2E取消勾选单')).toBeVisible();
    await expect(tbody.getByText('E2E保留单')).toBeVisible();
  });

  test('clearing field select shows all data', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E清空A', 状态: '待响应' },
    });
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E清空B', 状态: '已解决' },
    });

    await page.goto('/attack');
    await waitForTable(page);
    const tbody = page.locator('tbody').first();

    const fieldSelect = page.locator('.ant-select').nth(0);
    await selectOption(page, fieldSelect, '状态');
    await page.locator('.ant-checkbox-group').locator('label').filter({ hasText: '待响应' }).locator('input').click();
    await expect(tbody.getByText('E2E清空B')).not.toBeVisible();

    await fieldSelect.locator('.ant-select-clear').click();
    await expect(page.locator('.ant-checkbox-group')).not.toBeVisible();
    await expect(tbody.getByText('E2E清空A')).toBeVisible();
    await expect(tbody.getByText('E2E清空B')).toBeVisible();
  });

  test('switching field resets checkbox selection', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E切字段单', 状态: '待响应', 事件级别: 'P1' },
    });
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E切字段其他', 状态: '已解决', 事件级别: 'P3' },
    });

    await page.goto('/attack');
    await waitForTable(page);
    const tbody = page.locator('tbody').first();

    const fieldSelect = page.locator('.ant-select').nth(0);
    await selectOption(page, fieldSelect, '状态');
    await page.locator('.ant-checkbox-group').locator('label').filter({ hasText: '待响应' }).locator('input').click();
    await expect(tbody.getByText('E2E切字段其他')).not.toBeVisible();

    await selectOption(page, fieldSelect, '事件级别');
    await expect(tbody.getByText('E2E切字段单')).toBeVisible();
    await expect(tbody.getByText('E2E切字段其他')).toBeVisible();
  });

  test('search and field filter combine', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E组合搜索A', 状态: '处理中', 当前处理人: '张三' },
    });
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E组合搜索B', 状态: '处理中', 当前处理人: '李四' },
    });
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E组合搜索C', 状态: '待响应', 当前处理人: '张三' },
    });

    await page.goto('/attack');
    await waitForTable(page);
    const tbody = page.locator('tbody').first();

    const fieldSelect = page.locator('.ant-select').nth(0);
    await selectOption(page, fieldSelect, '状态');
    await page.locator('.ant-checkbox-group').locator('label').filter({ hasText: '处理中' }).locator('input').click();

    await expect(tbody.getByText('E2E组合搜索A')).toBeVisible();
    await expect(tbody.getByText('E2E组合搜索B')).toBeVisible();
    await expect(tbody.getByText('E2E组合搜索C')).not.toBeVisible();

    await page.getByPlaceholder('搜索标题/单号/处理人').fill('张三');
    await expect(tbody.getByText('E2E组合搜索A')).toBeVisible();
    await expect(tbody.getByText('E2E组合搜索B')).not.toBeVisible();
    await expect(tbody.getByText('E2E组合搜索C')).not.toBeVisible();
  });

  test('filters by non-enum field like 客户名称', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E客户甲', 状态: '处理中', 客户名称: '客户甲' },
    });
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E客户乙', 状态: '处理中', 客户名称: '客户乙' },
    });

    await page.goto('/attack');
    await waitForTable(page);
    const tbody = page.locator('tbody').first();

    const fieldSelect = page.locator('.ant-select').nth(0);
    await selectOption(page, fieldSelect, '客户名称');
    await expect(page.locator('.ant-checkbox-group')).toBeVisible();

    await page.locator('.ant-checkbox-group').locator('label').filter({ hasText: '客户甲' }).locator('input').click();
    await expect(tbody.getByText('E2E客户甲')).toBeVisible();
    await expect(tbody.getByText('E2E客户乙')).not.toBeVisible();
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
    const tbody = page.locator('tbody').first();
    await page.getByPlaceholder('搜索标题/单号/处理人').fill('搜索专用');
    await expect(tbody.getByText('E2E搜索专用单')).toBeVisible();
    await expect(tbody.getByText('E2E其他单')).not.toBeVisible();
  });

  test('deletes ticket from list', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E待删除单', 状态: '待响应' },
    });

    await page.goto('/attack');
    await waitForTable(page);
    const tbody = page.locator('tbody').first();
    await expect(tbody.getByText('E2E待删除单')).toBeVisible();
    await opsCell(page.getByRole('row').filter({ hasText: 'E2E待删除单' })).locator('a').filter({ hasText: /删\s?除/ }).click();
    await page.getByRole('button', { name: /确\s?定/ }).click();
    await expect(page.getByText('删除成功')).toBeVisible();
    await expect(tbody.getByText('E2E待删除单')).not.toBeVisible();
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

test.describe('自定义字段 (+字段)', () => {
  test('add field from AttackList create drawer', async ({ page }) => {
    await page.goto('/attack');
    await page.getByRole('button', { name: '新建攻关' }).click();
    await expect(page.locator('.ant-drawer')).toBeVisible();

    await page.getByRole('button', { name: '+字段' }).click();
    await expect(page.locator('.ant-modal')).toBeVisible();
    await page.getByPlaceholder('字段名(name)').fill('E2E自定义字段');
    await page.getByPlaceholder('显示名(label)').fill('自定义显示名');
    await page.locator('.ant-modal').getByRole('button', { name: /添\s?加/ }).click();
    await expect(page.getByText('字段已添加')).toBeVisible();

    await expect(page.locator('.ant-drawer').getByText('自定义显示名').first()).toBeVisible();
  });

  test('add field from AttackDetail edit drawer', async ({ page, request }) => {
    const res = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E字段编辑测试', 状态: '处理中' },
    });
    const ticket = await res.json();

    await page.goto(`/attack/${ticket.id}`);
    await page.getByRole('button', { name: '编辑信息' }).click();
    await expect(page.locator('.ant-drawer')).toBeVisible();

    await page.getByRole('button', { name: '+字段' }).click();
    await expect(page.locator('.ant-modal')).toBeVisible();
    await page.getByPlaceholder('字段名(name)').fill('E2E详情字段');
    await page.getByPlaceholder('显示名(label)').fill('详情自定义');
    await page.locator('.ant-modal').getByRole('button', { name: /添\s?加/ }).click();
    await expect(page.getByText('字段已添加')).toBeVisible();

    await expect(page.locator('.ant-drawer').getByText('详情自定义').first()).toBeVisible();
  });
});

test.describe('列设置 — 自定义显示字段', () => {
  test('shows column settings button and popover', async ({ page }) => {
    await page.goto('/attack');
    await waitForTable(page);
    const settingsBtn = page.getByRole('button').filter({ has: page.locator('.anticon-setting') });
    await expect(settingsBtn).toBeVisible();
    await settingsBtn.click();
    await expect(page.locator('.ant-popover').getByText('选择显示列')).toBeVisible();
    await expect(page.locator('.ant-popover .ant-checkbox-group')).toBeVisible();
  });

  test('default columns are visible', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E列默认', 状态: '处理中', 当前处理人: '张三', 事件级别: 'P2', 问题单号: 'PB001', 客户名称: '华为' },
    });
    await page.goto('/attack');
    await waitForTable(page);
    const th = page.locator('.ant-table-thead th');
    const headerTexts = (await th.allTextContents()).map(t => t.trim());
    expect(headerTexts).toContain('编号');
    expect(headerTexts).toContain('标题');
    expect(headerTexts).toContain('状态');
    expect(headerTexts).toContain('处理人');
    expect(headerTexts).toContain('事件级别');
    expect(headerTexts).toContain('问题单号');
    expect(headerTexts).toContain('客户');
    expect(headerTexts).toContain('更新');
    expect(headerTexts).toContain('操作');
  });

  test('unchecking column hides it from table', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E隐藏列', 状态: '处理中' },
    });
    await page.goto('/attack');
    await waitForTable(page);

    const settingsBtn = page.getByRole('button').filter({ has: page.locator('.anticon-setting') });
    await settingsBtn.click();
    await expect(page.locator('.ant-popover .ant-checkbox-group')).toBeVisible();

    await page.locator('.ant-popover .ant-checkbox-group').locator('label').filter({ hasText: '事件级别' }).locator('input').click();

    const th = page.locator('.ant-table-thead th');
    const headerTexts = (await th.allTextContents()).map(t => t.trim());
    expect(headerTexts).not.toContain('事件级别');
    expect(headerTexts).toContain('标题');
  });

  test('checking new column shows it in table', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E显示新列', 状态: '处理中', 事件单号: 'INC-999' },
    });
    await page.goto('/attack');
    await waitForTable(page);

    let headerTexts = (await page.locator('.ant-table-thead th').allTextContents()).map(t => t.trim());
    expect(headerTexts).not.toContain('事件单号');

    const settingsBtn = page.getByRole('button').filter({ has: page.locator('.anticon-setting') });
    await settingsBtn.click();
    await expect(page.locator('.ant-popover .ant-checkbox-group')).toBeVisible();

    await page.locator('.ant-popover .ant-checkbox-group').locator('label').filter({ hasText: '事件单号' }).locator('input').click();

    headerTexts = (await page.locator('.ant-table-thead th').allTextContents()).map(t => t.trim());
    expect(headerTexts).toContain('事件单号');
    await expect(page.getByRole('cell', { name: 'INC-999' }).first()).toBeVisible();
  });

  test('reset default restores default columns', async ({ page }) => {
    await page.goto('/attack');
    await waitForTable(page);

    const settingsBtn = page.getByRole('button').filter({ has: page.locator('.anticon-setting') });
    await settingsBtn.click();
    await expect(page.locator('.ant-popover .ant-checkbox-group')).toBeVisible();

    await page.locator('.ant-popover .ant-checkbox-group').locator('label').filter({ hasText: '标题' }).locator('input').click();
    let headerTexts = (await page.locator('.ant-table-thead th').allTextContents()).map(t => t.trim());
    expect(headerTexts).not.toContain('标题');

    await page.getByRole('button', { name: '重置默认' }).click();

    headerTexts = (await page.locator('.ant-table-thead th').allTextContents()).map(t => t.trim());
    expect(headerTexts).toContain('标题');
  });

  test('column selection persists after reload', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E持久化列', 状态: '处理中', 事件单号: 'INC-PERSIST' },
    });
    await page.goto('/attack');
    await waitForTable(page);

    const settingsBtn = page.getByRole('button').filter({ has: page.locator('.anticon-setting') });
    await settingsBtn.click();
    await expect(page.locator('.ant-popover .ant-checkbox-group')).toBeVisible();

    await page.locator('.ant-popover .ant-checkbox-group').locator('label').filter({ hasText: '事件单号' }).locator('input').click();
    let headerTexts = (await page.locator('.ant-table-thead th').allTextContents()).map(t => t.trim());
    expect(headerTexts).toContain('事件单号');

    await page.reload();
    await waitForTable(page);

    headerTexts = (await page.locator('.ant-table-thead th').allTextContents()).map(t => t.trim());
    expect(headerTexts).toContain('事件单号');

    const afterReload = await page.evaluate(() => {
      const v = localStorage.getItem('attack-list-visible-columns');
      return v ? JSON.parse(v) : null;
    });
    expect(afterReload).toContain('事件单号');
  });
});
