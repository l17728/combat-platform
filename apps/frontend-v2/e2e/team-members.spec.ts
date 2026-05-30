import { test, expect } from '@playwright/test';
import { API, selectOption, waitForDrawer, waitForTable } from './helpers';

test.describe('攻关单 - 成员管理与默认信息广场 tab', () => {
  test.beforeEach(async ({ request }) => {
    // 准备人员清单,确保多选有选项可挑
    for (const [姓名, 部门] of [['周成员一', '研发一部'], ['周成员二', '研发一部'], ['周组长', '研发二部']] as const) {
      await request.post(`${API}/api/nodes/person`, { data: { 姓名, 部门 } });
    }
  });

  test('新建攻关单后自动出现「信息广场」自定义 tab', async ({ page }) => {
    await page.goto('/attack');
    await page.getByRole('button', { name: '新建攻关' }).click();
    await waitForDrawer(page);
    await page.locator('.ant-drawer').getByLabel('标题').fill('E2E默认信息广场单');
    await page.locator('.ant-drawer-extra button').click();
    await expect(page.getByText('创建成功')).toBeVisible();
    await expect(page).toHaveURL(/\/attack\//);
    // 信息广场 tab 应出现在标签栏(自定义类型,可关闭)
    await expect(page.locator('.ant-tabs-tab').filter({ hasText: '信息广场' })).toBeVisible({ timeout: 10000 });
  });

  test('新建攻关时 攻关成员 是多选,可选多人;创建后成员管理 tab 列表正确', async ({ page }, testInfo) => {
    // 全量跑套时人员表累积大量条目,Select 下拉渲染慢导致 selectOption 轮询超时;翻倍 timeout 吸收
    testInfo.setTimeout(60_000);
    await page.goto('/attack');
    await page.getByRole('button', { name: '新建攻关' }).click();
    await waitForDrawer(page);
    const drawer = page.locator('.ant-drawer');
    await drawer.getByLabel('标题').fill('E2E成员多选单');

    // 攻关组长 单选(用 getByLabel 精确匹配,避免 hasText:组长 误中含 tooltip 的成员项)
    const leaderItem = drawer.locator('.ant-form-item').filter({ has: page.locator('label.ant-form-item-required, label').filter({ hasText: /^攻关组长$/ }) });
    await selectOption(page, leaderItem.locator('.ant-select').first(), '周组长');

    // 攻关成员 多选
    const memberItem = drawer.locator('.ant-form-item').filter({ has: page.locator('label').filter({ hasText: /^攻关成员$/ }) });
    await selectOption(page, memberItem.locator('.ant-select').first(), '周成员一');
    await selectOption(page, memberItem.locator('.ant-select').first(), '周成员二');

    await page.locator('.ant-drawer-extra button').click();
    await expect(page.getByText('创建成功')).toBeVisible();
    await expect(page).toHaveURL(/\/attack\//);

    // 跳到 成员管理 tab,应看到 3 行
    await page.locator('.ant-tabs-tab').filter({ hasText: '成员管理' }).click();
    await waitForTable(page);
    await expect(page.locator('.ant-tabs-tabpane-active').locator('tbody').getByText('周组长')).toBeVisible();
    await expect(page.locator('.ant-tabs-tabpane-active').locator('tbody').getByText('周成员一')).toBeVisible();
    await expect(page.locator('.ant-tabs-tabpane-active').locator('tbody').getByText('周成员二')).toBeVisible();
    // 角色 Tag 标记
    await expect(page.locator('.ant-tabs-tabpane-active').locator('tbody').locator('tr').filter({ hasText: '周组长' }).locator('.ant-tag').filter({ hasText: '组长' })).toBeVisible();
    await expect(page.locator('.ant-tabs-tabpane-active').locator('tbody').locator('tr').filter({ hasText: '周成员一' }).locator('.ant-tag').filter({ hasText: '组员' })).toBeVisible();
  });

  test('成员管理 tab 支持新增、修改角色、删除,且回写 攻关组长/攻关成员', async ({ page, request }) => {
    // 直接 API 建一个攻关单作为起点
    const createRes = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E成员CRUD单', 状态: '处理中' },
    });
    const ticket = await createRes.json();
    await page.goto(`/attack/${ticket.id}`);
    await page.locator('.ant-tabs-tab').filter({ hasText: '成员管理' }).click();

    // 应显示空状态
    await expect(page.getByText(/暂无成员/)).toBeVisible();

    // 新增一名组长
    await page.getByRole('button', { name: /添\s?加成员/ }).click();
    await waitForDrawer(page);
    const addDrawer = page.locator('.ant-drawer').last();
    await selectOption(page, addDrawer.locator('.ant-form-item').filter({ hasText: '姓名' }).locator('.ant-select').first(), '周组长');
    await selectOption(page, addDrawer.locator('.ant-form-item').filter({ hasText: '角色' }).locator('.ant-select').first(), '组长');
    await addDrawer.locator('.ant-drawer-extra button').click();
    await expect(page.getByText('成员已更新').last()).toBeVisible();

    // 表格里应有这一行
    await expect(page.locator('.ant-tabs-tabpane-active').locator('tbody').getByText('周组长')).toBeVisible();

    // 修改角色:组长改组员
    await page.locator('.ant-tabs-tabpane-active').locator('tbody').locator('tr').filter({ hasText: '周组长' }).getByText('修改角色').click();
    await waitForDrawer(page);
    const editDrawer = page.locator('.ant-drawer').last();
    await selectOption(page, editDrawer.locator('.ant-form-item').filter({ hasText: '角色' }).locator('.ant-select').first(), '组员');
    await editDrawer.locator('.ant-drawer-extra button').click();
    await expect(page.getByText('成员已更新').last()).toBeVisible();
    await expect(page.locator('.ant-tabs-tabpane-active').locator('tbody').locator('tr').filter({ hasText: '周组长' }).locator('.ant-tag').filter({ hasText: '组员' })).toBeVisible();

    // API 验证回写:此时无组长,攻关组长应为空
    const after = await request.get(`${API}/api/nodes/${ticket.id}`);
    const data = await after.json();
    expect(data.properties['攻关组长'] ?? '').toBe('');
    expect(data.properties['攻关成员']).toContain('周组长');

    // 删除该成员
    await page.locator('.ant-tabs-tabpane-active').locator('tbody').locator('tr').filter({ hasText: '周组长' }).getByText(/删\s?除/).click();
    await page.getByRole('button', { name: /确\s?定/ }).click();
    await expect(page.getByText('成员已更新').last()).toBeVisible();
    await expect(page.locator('.ant-tabs-tabpane-active').locator('tbody').getByText('周组长')).not.toBeVisible();
  });
});
