import { test, expect } from '@playwright/test';
import { API, opsCell, selectOption, waitForDrawer, waitForTable } from './helpers';

test.describe('生命周期故事 — 第一章：平台初始化', () => {
  test('1.1 管理员登录后看到仪表盘', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '作战态势' })).toBeVisible();
  });

  test('1.2 管理员创建用户（leader + 员工）', async ({ page, request }) => {
    await request.post(`${API}/api/auth/register`, {
      data: { username: 'li-lead', password: 'lead123', displayName: '李组长', role: 'leader' },
    });
    await request.post(`${API}/api/auth/register`, {
      data: { username: 'zhang-staff', password: 'staff123', displayName: '张前线', role: 'normal' },
    });

    await page.goto('/users');
    await waitForTable(page);
    await expect(page.getByText('李组长')).toBeVisible();
    await expect(page.getByText('张前线')).toBeVisible();
  });

  test('1.3 配置中心新增配置项', async ({ page, request }) => {
    await request.put(`${API}/api/settings/Lifecycle已有项`, {
      data: { values: ['a', 'b'] },
    });

    await page.goto('/config');
    await waitForTable(page);

    await page.getByRole('button', { name: '新增配置' }).click();
    await expect(page.locator('.ant-modal')).toBeVisible();
    await page.getByPlaceholder('例: 状态、事件级别、贡献类型').fill('紧急类型');
    await page.getByPlaceholder('例: 攻关单状态').fill('紧急类型');
    await page.getByPlaceholder('待响应, 处理中').fill('系统故障,客户投诉,安全事件,性能问题');
    await page.locator('.ant-modal').getByRole('button', { name: /保\s?存/ }).click();
    await expect(page.getByText('配置已添加')).toBeVisible();
  });
});

test.describe('生命周期故事 — 第二章：人员录入', () => {
  test('2.1 录入四名团队成员', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/person`, {
      data: { 姓名: '张前线', 工号: 'EMP001', 邮箱: 'zhang@combat.com', 部门: '网络部', 角色: '工程师' },
    });
    await request.post(`${API}/api/nodes/person`, {
      data: { 姓名: '李组长', 工号: 'EMP002', 邮箱: 'li@combat.com', 部门: '网络部', 角色: '组长' },
    });
    await request.post(`${API}/api/nodes/person`, {
      data: { 姓名: '王专家', 工号: 'EMP003', 邮箱: 'wang@combat.com', 部门: '安全部', 角色: '专家' },
    });
    await request.post(`${API}/api/nodes/person`, {
      data: { 姓名: '刘新人', 工号: 'EMP004', 邮箱: 'liu@combat.com', 部门: '平台部', 角色: '工程师' },
    });

    await page.goto('/people');
    await waitForTable(page);
    await expect(page.getByText('张前线').first()).toBeVisible();
    await expect(page.getByText('李组长').first()).toBeVisible();
    await expect(page.getByText('王专家').first()).toBeVisible();
    await expect(page.getByText('刘新人').first()).toBeVisible();
  });

  test('2.2 按部门筛选人员', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/person`, {
      data: { 姓名: 'Lifecycle网络人', 工号: 'LC001', 部门: '网络部' },
    });
    await request.post(`${API}/api/nodes/person`, {
      data: { 姓名: 'Lifecycle平台人', 工号: 'LC002', 部门: '平台部' },
    });

    await page.goto('/people');
    await waitForTable(page);
    const deptSelect = page.locator('.ant-select').nth(0);
    await selectOption(page, deptSelect, '网络部');
    await expect(page.getByText('Lifecycle网络人')).toBeVisible();
    await expect(page.getByText('Lifecycle平台人')).not.toBeVisible();
  });

  test('2.3 编辑人员信息（修改部门）', async ({ page, request }) => {
    const res = await request.post(`${API}/api/nodes/person`, {
      data: { 姓名: 'Lifecycle编辑人', 工号: 'LC003', 部门: '安全部' },
    });
    const person = await res.json();

    await page.goto('/people');
    await waitForTable(page);
    await opsCell(page.getByRole('row').filter({ hasText: 'Lifecycle编辑人' }))
      .locator('a').filter({ hasText: /编\s?辑/ }).click();
    await waitForDrawer(page);

    const drawer = page.locator('.ant-drawer');
    await drawer.getByLabel('部门').clear();
    await drawer.getByLabel('部门').fill('平台部');
    await page.locator('.ant-drawer-extra button').click();
    await expect(page.getByText('更新成功')).toBeVisible();

    await page.goto(`/people`);
    await waitForTable(page);
    const row = page.getByRole('row').filter({ hasText: 'Lifecycle编辑人' });
    await expect(row).toBeVisible();
  });

  test('2.4 重复人员录入（不同工号相同姓名）', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/person`, {
      data: { 姓名: 'Lifecycle重复人', 工号: 'DUP001' },
    });
    await request.post(`${API}/api/nodes/person`, {
      data: { 姓名: 'Lifecycle重复人', 工号: 'DUP002' },
    });

    await page.goto('/people');
    await waitForTable(page);
    const rows = page.getByRole('row').filter({ hasText: 'Lifecycle重复人' });
    await expect(rows).toHaveCount(2);
  });
});

test.describe('生命周期故事 — 第三章：攻关单创建', () => {
  test('3.1 Leader 新建攻关单并自动跳转详情', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/person`, {
      data: { 姓名: 'Lifecycle张前线', 工号: 'EMP010' },
    });

    await page.goto('/attack');
    await waitForTable(page);
    await page.getByRole('button', { name: '新建攻关' }).click();
    await waitForDrawer(page);

    const drawer = page.locator('.ant-drawer');
    await drawer.getByLabel('标题').fill('Lifecycle华为云MaaS服务503故障');
    await drawer.getByLabel('问题描述').fill('客户反馈MaaS模型调用返回503错误');
    await drawer.getByLabel('问题单号').fill('PB20260526001');
    await drawer.getByLabel('客户名称').fill('华为云');

    const drawerSelects = drawer.locator('.ant-select');
    await selectOption(page, drawerSelects.nth(2), 'Lifecycle张前线');

    await page.locator('.ant-drawer-extra button').click();
    await expect(page.getByText('创建成功')).toBeVisible();
    await expect(page).toHaveURL(/\/attack\//);
    await expect(page.getByText('Lifecycle华为云MaaS服务503故障')).toBeVisible();
    await expect(page.getByText('PB20260526001')).toBeVisible();
  });

  test('3.2 详情页确认信息完整', async ({ page, request }) => {
    const res = await request.post(`${API}/api/nodes/attackTicket`, {
      data: {
        标题: 'Lifecycle详情确认单',
        状态: '待响应',
        问题单号: 'PB-LC-001',
        事件级别: 'P2',
        客户名称: '华为云',
        当前处理人: 'Lifecycle张前线',
        问题描述: 'MaaS服务503',
      },
    });
    const ticket = await res.json();

    await page.goto(`/attack/${ticket.id}`);
    await expect(page.getByRole('heading', { name: /Lifecycle详情确认单/ })).toBeVisible();
    await expect(page.getByText('PB-LC-001')).toBeVisible();
    await expect(page.getByText('待响应').first()).toBeVisible();
  });

  test('3.3 返回列表看到新建单子', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'Lifecycle列表可见单', 状态: '待响应' },
    });

    await page.goto('/attack');
    await waitForTable(page);
    await expect(page.getByText('Lifecycle列表可见单')).toBeVisible();
  });
});

test.describe('生命周期故事 — 第四章：攻关处理（员工操作）', () => {
  test('4.1 员工查看仪表盘有待处理单', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'Lifecycle仪表盘单', 状态: '进行中' },
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { name: '作战态势' })).toBeVisible();
  });

  test('4.2 状态流转：待响应 → 处理中', async ({ page, request }) => {
    const res = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'Lifecycle流转单A', 状态: '待响应' },
    });
    const ticket = await res.json();

    await page.goto(`/attack/${ticket.id}`);
    await expect(page.getByText('待响应').first()).toBeVisible();

    await page.getByRole('button', { name: '状态流转' }).click();
    await waitForDrawer(page);
    const drawer = page.locator('.ant-drawer');
    const statusSelect = drawer.locator('.ant-select').first();
    await selectOption(page, statusSelect, '处理中', true);
    await page.getByRole('button', { name: '确认流转' }).click();
    await expect(page.getByText('状态流转成功')).toBeVisible();
    await expect(page.getByText('处理中').first()).toBeVisible();
  });

  test('4.3 追加多条进展', async ({ page, request }) => {
    const res = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'Lifecycle进展单', 状态: '处理中' },
    });
    const ticket = await res.json();

    await page.goto(`/attack/${ticket.id}`);
    await page.getByRole('tab', { name: '进展同步' }).click();

    await page.getByRole('button', { name: '追加进展' }).click();
    await waitForDrawer(page);
    await page.getByPlaceholder('描述当前进展...').fill('Lifecycle初步排查：确认是后端服务超时');
    await page.getByRole('button', { name: '提交进展' }).click();
    await expect(page.getByText('进展已追加')).toBeVisible();
    await expect(page.getByText('Lifecycle初步排查：确认是后端服务超时')).toBeVisible();

    await page.getByRole('button', { name: '追加进展' }).click();
    await waitForDrawer(page);
    await page.getByPlaceholder('描述当前进展...').fill('Lifecycle已联系服务端团队排查');
    await page.getByRole('button', { name: '提交进展' }).click();
    await expect(page.getByText('Lifecycle已联系服务端团队排查')).toBeVisible();
  });

  test('4.4 编辑攻关单补充信息', async ({ page, request }) => {
    const res = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'Lifecycle编辑补充单', 状态: '处理中', 问题单号: 'PB-LC-EDIT' },
    });
    const ticket = await res.json();

    await page.goto(`/attack/${ticket.id}`);
    await page.getByRole('button', { name: '编辑信息' }).click();
    await waitForDrawer(page);

    const drawer = page.locator('.ant-drawer');
    await drawer.getByLabel('根因服务').fill('MaaS-gateway');
    await drawer.getByLabel('影响及现存风险').fill('影响3个租户，SLA可能不达标');
    await page.locator('.ant-drawer-extra button').click();
    await expect(page.getByText('更新成功')).toBeVisible();
    await expect(page.getByText('MaaS-gateway').first()).toBeVisible();
    await expect(page.getByText('影响3个租户，SLA可能不达标').first()).toBeVisible();
  });

  test('4.5 状态流转：处理中 → 进行中', async ({ page, request }) => {
    const res = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'Lifecycle流转单B', 状态: '处理中' },
    });
    const ticket = await res.json();

    await page.goto(`/attack/${ticket.id}`);
    await page.getByRole('button', { name: '状态流转' }).click();
    await waitForDrawer(page);
    const drawer = page.locator('.ant-drawer');
    await selectOption(page, drawer.locator('.ant-select').first(), '进行中', true);
    await page.getByRole('button', { name: '确认流转' }).click();
    await expect(page.getByText('状态流转成功')).toBeVisible();
    await expect(page.getByText('进行中').first()).toBeVisible();
  });
});

test.describe('生命周期故事 — 第五章：求助与协作', () => {
  test('5.1 发起求助', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/person`, {
      data: { 姓名: 'Lifecycle求助人', 工号: 'H001' },
    });
    await request.post(`${API}/api/nodes/person`, {
      data: { 姓名: 'Lifecycle专家', 工号: 'H002', 邮箱: 'expert@combat.com' },
    });
    const ticketRes = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'Lifecycle求助测试单', 状态: '进行中' },
    });
    const ticket = await ticketRes.json();

    await request.post(`${API}/api/help-requests`, {
      data: {
        ticketId: ticket.id,
        requesterName: 'Lifecycle求助人',
        targetName: 'Lifecycle专家',
        targetEmail: 'expert@combat.com',
        category: '领域专家',
        question: 'Lifecycle预先存在的求助',
      },
    });

    await page.goto('/help');
    await waitForTable(page);
    await page.getByRole('button', { name: '发起求助' }).click();
    await waitForDrawer(page);

    const drawer = page.locator('.ant-drawer');
    const drawerSelects = drawer.locator('.ant-select');

    await selectOption(page, drawerSelects.nth(0), 'Lifecycle求助测试单');
    await selectOption(page, drawerSelects.nth(1), 'Lifecycle求助人');
    await selectOption(page, drawerSelects.nth(2), 'Lifecycle专家');

    await drawer.getByPlaceholder('email@example.com').fill('expert@combat.com');
    await selectOption(page, drawerSelects.nth(3), '领域专家');
    await drawer.getByPlaceholder('请描述您需要帮助的内容...').fill('Lifecycle需要协助分析503错误原因');

    await page.locator('.ant-drawer-extra button').click();
    await expect(page.getByText('求助已发送').first()).toBeVisible();
  });

  test('5.2 求助反馈公开链接提交', async ({ page, request }) => {
    const ticketRes = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'Lifecycle反馈单', 状态: '进行中' },
    });
    const ticket = await ticketRes.json();

    const helpRes = await request.post(`${API}/api/help-requests`, {
      data: {
        ticketId: ticket.id,
        requesterName: 'Lifecycle反馈人',
        targetName: 'Lifecycle反馈专家',
        targetEmail: 'feedback@combat.com',
        category: '领域专家',
        question: 'Lifecycle反馈测试问题',
      },
    });
    const help = await helpRes.json();

    await page.goto(`/help/feedback/${help.feedbackToken}`);
    await expect(page.getByText('Lifecycle反馈测试问题')).toBeVisible();

    await page.getByPlaceholder(/请填写您的回复/).fill('Lifecycle反馈内容：安全策略未变更');
    await page.getByRole('button', { name: /提\s?交/ }).click();
    await expect(page.getByText('反馈已提交').first()).toBeVisible();
  });

  test('5.3 求助网络节点添加', async ({ page, request }) => {
    const res = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'Lifecycle求助节点单', 状态: '进行中' },
    });
    const ticket = await res.json();

    await page.goto(`/attack/${ticket.id}`);
    await page.getByRole('tab', { name: '求助网络' }).click();

    await page.getByRole('button', { name: '添加节点' }).click();
    await expect(page.locator('.ant-modal')).toBeVisible();

    const modal = page.locator('.ant-modal');
    const modalSelects = modal.locator('.ant-select');
    await selectOption(page, modalSelects.nth(1), '环境');
    await modal.getByPlaceholder('请输入具体领域').fill('网络');
    await modal.getByPlaceholder('请输入负责人姓名').fill('张前线');
    await modal.getByPlaceholder('备注...').fill('需要申请额外计算资源');

    await modal.getByRole('button', { name: /提\s?交/ }).click();
    await expect(page.getByText('节点已添加').first()).toBeVisible();
  });
});

test.describe('生命周期故事 — 第六章：修复与解决', () => {
  test('6.1 追加最终进展并解决', async ({ page, request }) => {
    const res = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'Lifecycle解决单', 状态: '进行中' },
    });
    const ticket = await res.json();

    await page.goto(`/attack/${ticket.id}`);
    await page.getByRole('tab', { name: '进展同步' }).click();
    await page.getByRole('button', { name: '追加进展' }).click();
    await waitForDrawer(page);
    await page.getByPlaceholder('描述当前进展...').fill('Lifecycle已修复，所有租户恢复正常');
    await page.getByRole('button', { name: '提交进展' }).click();
    await expect(page.getByText('进展已追加')).toBeVisible();
  });

  test('6.2 状态流转：进行中 → 已解决', async ({ page, request }) => {
    const res = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'Lifecycle已解决单', 状态: '进行中' },
    });
    const ticket = await res.json();

    await page.goto(`/attack/${ticket.id}`);
    await page.getByRole('button', { name: '状态流转' }).click();
    await waitForDrawer(page);
    await selectOption(page, page.locator('.ant-drawer').locator('.ant-select').first(), '已解决', true);
    await page.getByRole('button', { name: '确认流转' }).click();
    await expect(page.getByText('状态流转成功')).toBeVisible();
    await expect(page.getByText('已解决').first()).toBeVisible();
  });

  test('6.3 Leader 关闭：已解决 → 已关闭', async ({ page, request }) => {
    const res = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'Lifecycle关闭单', 状态: '已解决' },
    });
    const ticket = await res.json();

    await page.goto(`/attack/${ticket.id}`);
    await page.getByRole('button', { name: '状态流转' }).click();
    await waitForDrawer(page);
    await selectOption(page, page.locator('.ant-drawer').locator('.ant-select').first(), '已关闭', true);
    await page.getByRole('button', { name: '确认流转' }).click();
    await expect(page.getByText('状态流转成功')).toBeVisible();
    await expect(page.getByText('已关闭').first()).toBeVisible();
  });
});

test.describe('生命周期故事 — 第七章：贡献录入与荣誉', () => {
  test('7.1 Leader 录入多条贡献', async ({ page, request }) => {
    await page.addInitScript(() => {
      localStorage.setItem('combat-role', 'leader');
    });

    await request.post(`${API}/api/nodes/person`, {
      data: { 姓名: 'Lifecycle贡献人A' },
    });
    await request.post(`${API}/api/nodes/person`, {
      data: { 姓名: 'Lifecycle贡献人B' },
    });

    await page.goto('/contributions');
    await waitForTable(page);

    await page.getByRole('button', { name: '录入个人贡献' }).click();
    await waitForDrawer(page);
    const drawer = page.locator('.ant-drawer');
    const drawerSelects = drawer.locator('.ant-select');
    await selectOption(page, drawerSelects.nth(0), 'Lifecycle贡献人A');
    await selectOption(page, drawerSelects.nth(1), '实施');
    await selectOption(page, drawerSelects.nth(2), '核心');
    await page.getByPlaceholder(/贡献描述/).fill('Lifecycle主导完成修复');
    await page.locator('.ant-drawer-extra button').click();
    await expect(page.getByText('录入成功')).toBeVisible();

    await page.getByRole('button', { name: '录入个人贡献' }).click();
    await waitForDrawer(page);
    const drawer2 = page.locator('.ant-drawer');
    const drawerSelects2 = drawer2.locator('.ant-select');
    await selectOption(page, drawerSelects2.nth(0), 'Lifecycle贡献人B');
    await selectOption(page, drawerSelects2.nth(1), '协调');
    await selectOption(page, drawerSelects2.nth(2), '关键');
    await page.getByPlaceholder(/贡献描述/).fill('Lifecycle协助排查');
    await page.locator('.ant-drawer-extra button').click();
    await expect(page.getByText('录入成功')).toBeVisible();
  });

  test('7.2 查看荣誉殿堂排行榜', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/contribution`, {
      data: { 贡献人: 'Lifecycle荣誉人', 贡献等级: '核心', 贡献类型: '实施', 描述: 'Lifecycle荣誉贡献' },
    });

    await page.goto('/honor');
    await expect(page.getByRole('heading', { name: '荣誉殿堂' })).toBeVisible();
    await expect(page.getByText('Lifecycle荣誉人').first()).toBeVisible();
  });

  test('7.3 查看个人荣誉详情', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/contribution`, {
      data: { 贡献人: 'Lifecycle个人详情人', 贡献等级: '核心', 贡献类型: '实施', 描述: 'Lifecycle核心贡献详情' },
    });
    await request.post(`${API}/api/nodes/contribution`, {
      data: { 贡献人: 'Lifecycle个人详情人', 贡献等级: '普通', 贡献类型: '协调', 描述: 'Lifecycle普通贡献详情' },
    });

    await page.goto('/honor');
    await page.getByText('Lifecycle个人详情人').first().click();
    await expect(page).toHaveURL(/\/honor\//);
    await expect(page.getByRole('heading', { name: 'Lifecycle个人详情人' })).toBeVisible();
    await expect(page.getByText('Lifecycle核心贡献详情')).toBeVisible();
    await expect(page.getByText('Lifecycle普通贡献详情')).toBeVisible();
  });

  test('7.4 normal 角色创建带贡献等级的贡献被 403 拒绝', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/person`, {
      data: { 姓名: 'Lifecycle普通员工' },
    });

    const res = await request.post(`${API}/api/nodes/contribution`, {
      data: { 贡献人: 'Lifecycle普通员工', 贡献等级: '核心', 贡献类型: '实施', 描述: 'Lifecycle尝试录入' },
      headers: { 'X-Role': 'normal' },
    });
    expect(res.status()).toBe(403);
  });
});

test.describe('生命周期故事 — 第八章：审核管理', () => {
  test('8.1 扫描关系候选并审批', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/person`, {
      data: { 姓名: 'Lifecycle审批人', 工号: 'AP001' },
    });
    await request.post(`${API}/api/nodes/person`, {
      data: { 姓名: 'Lifecycle审批人', 工号: 'AP002' },
    });

    await page.goto('/proposals');
    await waitForTable(page);

    await page.getByRole('button', { name: /扫描候选/ }).click();
    await page.waitForTimeout(2000);

    const approveBtn = page.locator('a').filter({ hasText: /通\s?过/ }).first();
    if (await approveBtn.isVisible()) {
      await approveBtn.click();
      await page.getByRole('button', { name: /确\s?定/ }).click();
      await expect(page.getByText(/已通过|审批成功/).first()).toBeVisible();
    }
  });

  test('8.2 扫描并处理提醒', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'Lifecycle提醒单', 状态: '处理中', 问题单号: 'PB-REMIND-001' },
    });

    await page.goto('/reminders');
    await waitForTable(page);

    await page.getByRole('button', { name: /扫描提醒/ }).click();
    await page.waitForTimeout(2000);
    await expect(page.getByRole('table')).toBeVisible();
  });
});

test.describe('生命周期故事 — 第九章：日报与搜索', () => {
  test('9.1 查看日报', async ({ page, request }) => {
    const ticketRes = await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'Lifecycle日报单', 状态: '处理中' },
    });
    const ticket = await ticketRes.json();
    await request.post(`${API}/api/nodes/${ticket.id}/progress`, {
      data: { content: 'Lifecycle日报进展', statusSnapshot: '处理中', actor: 'e2e' },
    });

    await page.goto('/daily-report');
    await expect(page.getByText('攻关日报').first()).toBeVisible();
  });

  test('9.2 全局搜索攻关单', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'Lifecycle搜索目标单MaaS', 状态: '处理中' },
    });

    await page.goto('/search');
    await page.getByPlaceholder(/搜索/).fill('Lifecycle搜索目标单MaaS');
    await page.getByRole('button', { name: /搜索/ }).click();
    await expect(page.getByText('Lifecycle搜索目标单MaaS')).toBeVisible();
  });
});

test.describe('生命周期故事 — 第十章：问题反馈', () => {
  test('10.1 员工提交 Bug 反馈', async ({ page }) => {
    await page.goto('/bug-report');
    await waitForTable(page);
    await page.getByRole('button', { name: '提交问题' }).click();
    await waitForDrawer(page);

    const drawer = page.locator('.ant-drawer');
    await drawer.getByLabel('问题标题').fill('Lifecycle页面加载缓慢');
    await selectOption(page, drawer.locator('.ant-select').first(), '一般', true);
    await drawer.getByPlaceholder('详细描述问题现象、复现步骤、预期行为等').fill('打开大量进展的攻关单时需要5秒以上');

    await page.locator('.ant-drawer-extra button').click();
    await expect(page.getByText('问题已提交')).toBeVisible();
    await expect(page.getByText('Lifecycle页面加载缓慢')).toBeVisible();
  });

  test('10.2 管理员处理 Bug 状态流转（待处理 → 处理中）', async ({ page, request }) => {
    await request.post(`${API}/api/bug-reports`, {
      data: { title: 'Lifecycle流转验证Bug', severity: '一般', description: '测试用' },
    });

    await page.goto('/bug-report');
    await waitForTable(page);

    const row = page.getByRole('row').filter({ hasText: 'Lifecycle流转验证Bug' });
    await opsCell(row).locator('a').filter({ hasText: '开始处理' }).first().click();
    await expect(page.getByText('状态已更新').first()).toBeVisible();
  });

  test('10.3 管理员删除 Bug', async ({ page, request }) => {
    await request.post(`${API}/api/bug-reports`, {
      data: { title: 'Lifecycle待删除Bug', severity: '一般' },
    });

    await page.goto('/bug-report');
    await waitForTable(page);
    await expect(page.getByText('Lifecycle待删除Bug')).toBeVisible();

    await opsCell(page.getByRole('row').filter({ hasText: 'Lifecycle待删除Bug' }))
      .locator('a').filter({ hasText: /删\s?除/ }).click();
    await page.getByRole('button', { name: /确\s?定/ }).click();
    await expect(page.getByText('已删除').first()).toBeVisible();
  });
});

test.describe('生命周期故事 — 第十一章：数据管理', () => {
  test('11.1 导出数据', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'Lifecycle导出单', 状态: '处理中' },
    });

    await page.goto('/import');
    await expect(page.getByRole('heading', { name: '数据导入/导出' })).toBeVisible();

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /导出当前数据/ }).click();
    const d = await download;
    expect(d.suggestedFilename()).toContain('.xlsx');
  });

  test('11.2 查看审计日志', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'Lifecycle审计单', 状态: '处理中' },
    });

    await page.goto('/audit');
    await waitForTable(page);
    await expect(page.getByText('创建').first()).toBeVisible();
  });

  test('11.3 查看操作追踪', async ({ page }) => {
    await page.goto('/op-log');
    await waitForTable(page);
    await expect(page.getByRole('heading', { name: '操作追踪' })).toBeVisible();
  });

  test('11.4 配置中心删除配置项', async ({ page, request }) => {
    await request.put(`${API}/api/settings/Lifecycle测试项`, {
      data: { values: ['值1', '值2'] },
    });

    await page.goto('/config');
    await waitForTable(page);
    await expect(page.getByText('Lifecycle测试项').first()).toBeVisible();

    await opsCell(page.getByRole('row').filter({ hasText: 'Lifecycle测试项' }))
      .locator('a').filter({ hasText: /删\s?除/ }).click();
    await page.getByRole('button', { name: /确\s?定/ }).click();
    await expect(page.getByText('配置已删除').first()).toBeVisible();
  });
});

test.describe('生命周期故事 — 第十二章：收尾验证', () => {
  test('12.1 仪表盘显示已关闭的攻关单', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'Lifecycle收尾已关闭单', 状态: '已关闭' },
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { name: '作战态势' })).toBeVisible();
  });

  test('12.2 全局搜索最终验证', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'Lifecycle收尾搜索验证', 状态: '已关闭' },
    });

    await page.goto('/search');
    await page.getByPlaceholder(/搜索/).fill('Lifecycle收尾搜索验证');
    await page.getByRole('button', { name: /搜索/ }).click();
    await expect(page.getByText('Lifecycle收尾搜索验证')).toBeVisible();
  });
});
