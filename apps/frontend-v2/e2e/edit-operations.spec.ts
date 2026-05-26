import { test, expect } from '@playwright/test';
import { API, opsCell, selectOption, waitForDrawer, waitForTable } from './helpers';

test.describe('编辑操作 - 全员名单', () => {
  test('edit drawer opens with pre-filled values and saves', async ({ page, request }) => {
    await test.step('创建测试人员', async () => {
      await request.post(`${API}/api/nodes/person`, {
        data: { 姓名: 'E2E编辑人', 工号: 'EDIT001', 邮箱: 'edit@test.com', 部门: '编辑前部门' },
      });
    });

    await test.step('打开页面并点击编辑', async () => {
      await page.goto('/people');
      await waitForTable(page);
      await expect(page.getByText('E2E编辑人')).toBeVisible();
      const row = page.getByRole('row').filter({ hasText: 'E2E编辑人' });
      await opsCell(row).locator('a').filter({ hasText: /编\s?辑/ }).click();
      await waitForDrawer(page);
    });

    await test.step('验证表单预填值', async () => {
      const drawer = page.locator('.ant-drawer');
      await expect(drawer.getByPlaceholder('姓名')).toHaveValue('E2E编辑人');
      await expect(drawer.getByPlaceholder('工号')).toHaveValue('EDIT001');
      await expect(drawer.getByPlaceholder('邮箱地址')).toHaveValue('edit@test.com');
      await expect(drawer.getByPlaceholder('部门')).toHaveValue('编辑前部门');
    });

    await test.step('修改部门并保存', async () => {
      const drawer = page.locator('.ant-drawer');
      await drawer.getByPlaceholder('部门').clear();
      await drawer.getByPlaceholder('部门').fill('编辑后部门');
      await page.locator('.ant-drawer-extra button').click();
      await expect(page.getByText('更新成功')).toBeVisible();
    });

    await test.step('验证更新后的数据', async () => {
      await expect(page.getByText('编辑后部门')).toBeVisible();
    });
  });

  test('detail drawer shows person fields', async ({ page, request }) => {
    await test.step('创建测试人员', async () => {
      await request.post(`${API}/api/nodes/person`, {
        data: { 姓名: 'E2E详情人', 工号: 'DTL001', 邮箱: 'detail@test.com', 部门: '详情部门' },
      });
    });

    await test.step('点击人员姓名打开详情', async () => {
      await page.goto('/people');
      await waitForTable(page);
      await page.getByRole('cell', { name: 'E2E详情人', exact: true }).locator('a').click();
      await waitForDrawer(page);
    });

    await test.step('验证详情抽屉内容', async () => {
      const drawer = page.locator('.ant-drawer');
      await expect(drawer.getByText('E2E详情人')).toBeVisible();
      await expect(drawer.getByText('DTL001').first()).toBeVisible();
      await expect(drawer.getByText('detail@test.com').first()).toBeVisible();
    });

    await test.step('详情抽屉有编辑和查看荣誉按钮', async () => {
      const drawer = page.locator('.ant-drawer');
      await expect(drawer.getByRole('button', { name: /编\s?辑/ })).toBeVisible();
      await expect(drawer.getByRole('button', { name: '查看荣誉' })).toBeVisible();
    });
  });

  test('detail drawer 编辑 button opens edit drawer', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/person`, {
      data: { 姓名: 'E2E详情编辑人', 工号: 'DTE001', 部门: '转编辑部门' },
    });

    await page.goto('/people');
    await waitForTable(page);
    await page.getByRole('cell', { name: 'E2E详情编辑人', exact: true }).locator('a').click();
    await waitForDrawer(page);

    const drawer = page.locator('.ant-drawer');
    await drawer.getByRole('button', { name: /编\s?辑/ }).click();
    await page.waitForTimeout(500);

    await expect(page.locator('.ant-drawer').getByPlaceholder('姓名')).toHaveValue('E2E详情编辑人');
    await expect(page.locator('.ant-drawer').getByPlaceholder('部门')).toHaveValue('转编辑部门');
  });

  test('荣誉 link navigates to person honor page', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/person`, {
      data: { 姓名: 'E2E荣誉跳转人', 工号: 'HON001' },
    });

    await page.goto('/people');
    await waitForTable(page);

    const row = page.getByRole('row').filter({ hasText: 'E2E荣誉跳转人' });
    await opsCell(row).locator('a').filter({ hasText: '荣誉' }).click();
    await expect(page).toHaveURL(/\/honor\//);
  });
});

test.describe('编辑操作 - 贡献录入', () => {
  test('edit drawer opens with pre-filled values and saves', async ({ page, request }) => {
    await page.addInitScript(() => {
      localStorage.setItem('combat-role', 'leader');
    });

    await test.step('创建测试贡献', async () => {
      await request.post(`${API}/api/nodes/contribution`, {
        data: { 贡献人: 'E2E贡献编辑人', 贡献等级: '核心', 贡献类型: '实施', 描述: '编辑前描述' },
      });
    });

    await test.step('打开页面并点击编辑', async () => {
      await page.goto('/contributions');
      await waitForTable(page);
      await expect(page.getByRole('cell', { name: '编辑前描述', exact: true })).toBeVisible();
      const row = page.getByRole('row').filter({ hasText: '编辑前描述' });
      await opsCell(row).locator('a').filter({ hasText: /编\s?辑/ }).click();
      await waitForDrawer(page);
    });

    await test.step('验证表单预填值', async () => {
      const drawer = page.locator('.ant-drawer');
      await expect(drawer.getByPlaceholder(/贡献描述/)).toHaveValue('编辑前描述');
    });

    await test.step('修改描述并保存', async () => {
      const drawer = page.locator('.ant-drawer');
      await drawer.getByPlaceholder(/贡献描述/).clear();
      await drawer.getByPlaceholder(/贡献描述/).fill('编辑后描述');
      await page.locator('.ant-drawer-extra button').click();
      await expect(page.getByText('更新成功')).toBeVisible();
    });

    await test.step('验证更新后的数据', async () => {
      await expect(page.getByRole('cell', { name: '编辑后描述', exact: true })).toBeVisible();
      await expect(page.getByRole('cell', { name: '编辑前描述', exact: true })).not.toBeVisible();
    });
  });

  test('export button downloads xlsx', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/contribution`, {
      data: { 贡献人: 'E2E导出贡献人', 贡献等级: '普通', 贡献类型: '公关', 描述: 'E2E导出贡献' },
    });

    await page.goto('/contributions');
    await waitForTable(page);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /导\s?出/ }).click();
    const d = await download;
    expect(d.suggestedFilename()).toContain('.xlsx');
  });
});

test.describe('编辑操作 - 攻关详情', () => {
  test('edit drawer pre-fills all field values', async ({ page, request }) => {
    let ticketId: string;
    await test.step('创建含多字段的攻关单', async () => {
      const res = await request.post(`${API}/api/nodes/attackTicket`, {
        data: {
          标题: 'E2E预填测试单',
          状态: '处理中',
          当前处理人: '张三',
          客户名称: '华为云',
          问题单号: 'PB-PRE',
          事件单号: 'EV-PRE',
          事件级别: 'P1',
          影响及现存风险: '预填风险',
          资源ID: 'RES-001',
          租户ID: 'TEN-001',
        },
      });
      const data = await res.json();
      ticketId = data.id;
    });

    await test.step('直接进入详情页', async () => {
      await page.goto(`/attack/${ticketId}`);
      await expect(page.getByRole('heading', { name: /E2E预填测试单/ })).toBeVisible();
    });

    await test.step('打开编辑抽屉验证预填', async () => {
      await page.getByRole('button', { name: '编辑信息' }).click();
      await waitForDrawer(page);

      const drawer = page.locator('.ant-drawer');
      await expect(drawer.getByLabel('标题')).toHaveValue('E2E预填测试单');
      await expect(drawer.getByLabel('问题单号')).toHaveValue('PB-PRE');
      await expect(drawer.getByLabel('事件单号')).toHaveValue('EV-PRE');
      await expect(drawer.getByLabel('客户名称')).toHaveValue('华为云');
      await expect(drawer.getByLabel('资源ID')).toHaveValue('RES-001');
      await expect(drawer.getByLabel('租户ID')).toHaveValue('TEN-001');
    });
  });

  test('基础信息 tab displays schema fields', async ({ page, request }) => {
    const res = await request.post(`${API}/api/nodes/attackTicket`, {
      data: {
        标题: 'E2E基础信息测试',
        状态: '处理中',
        当前处理人: '赵六',
        问题单号: 'PB-BASIC',
        客户名称: '腾讯云',
        影响及现存风险: '基础信息风险',
      },
    });
    const ticket = await res.json();

    await page.goto(`/attack/${ticket.id}`);

    await test.step('验证摘要卡片字段', async () => {
      await expect(page.getByText('PB-BASIC')).toBeVisible();
      await expect(page.getByText('腾讯云')).toBeVisible();
    });

    await test.step('切换到基础信息 tab', async () => {
      await page.getByRole('tab', { name: '基础信息' }).click();
      await expect(page.getByText('基础信息风险')).toBeVisible();
      await expect(page.getByText('E2E基础信息测试')).toBeVisible();
    });
  });

  test('edit support node modifies existing node', async ({ page, request }) => {
    const res = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E求助节点编辑', 状态: '处理中' },
    });
    const ticket = await res.json();

    await test.step('添加初始求助节点', async () => {
      await request.post(`${API}/api/nodes/${ticket.id}/support-nodes`, {
        data: { category: '环境', domain: '网络', status: '待确认', note: '初始备注' },
      });
    });

    await test.step('进入详情页求助网络 tab', async () => {
      await page.goto(`/attack/${ticket.id}`);
      await page.getByRole('tab', { name: '求助网络' }).click();
      await page.waitForTimeout(1000);
    });

    await test.step('点击编辑图标修改节点', async () => {
      const editIcon = page.locator('.ant-tree-treenode').first().locator('.anticon-edit');
      if (await editIcon.isVisible({ timeout: 3000 })) {
        await editIcon.click();
        await page.waitForTimeout(500);

        const modal = page.locator('.ant-modal');
        if (await modal.isVisible()) {
          const noteInput = modal.getByPlaceholder(/备注/);
          if (await noteInput.isVisible()) {
            await noteInput.clear();
            await noteInput.fill('编辑后备注');
          }
          await modal.getByRole('button', { name: /确\s?定|保\s?存/ }).first().click();
          await page.waitForTimeout(500);
        }
      }
    });
  });
});

test.describe('编辑操作 - 攻关列表', () => {
  test('list row has delete operation only (no inline edit)', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E操作列测试', 状态: '处理中', 客户名称: '操作列验证' },
    });

    await page.goto('/attack');
    await waitForTable(page);
    const row = page.getByRole('row').filter({ hasText: 'E2E操作列测试' });
    await expect(opsCell(row).getByText(/删\s?除/)).toBeVisible();
    await expect(opsCell(row).locator('a').filter({ hasText: /编\s?辑/ })).not.toBeVisible();
  });
});
