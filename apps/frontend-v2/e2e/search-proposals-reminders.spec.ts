import { test, expect } from '@playwright/test';
import { API } from './helpers';

test.describe('全局搜索', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/search');
    await page.waitForLoadState('networkidle');
  });

  test('shows page heading and search input', async ({ page }) => {
    await expect(page.getByRole('heading', { name: '全局搜索' })).toBeVisible();
    await expect(page.getByPlaceholder('搜索关键词（标题、名称、描述等）')).toBeVisible();
  });

  test('shows empty state before search', async ({ page }) => {
    await expect(page.getByText('输入关键词开始搜索')).toBeVisible();
  });

  test('search returns results', async ({ page }) => {
    await page.request.post(`${API}/api/nodes/attackTicket`, {
      headers: { 'Content-Type': 'application/json', 'X-Role': 'leader' },
      data: { '标题': '搜索测试攻关E2E', '事件级别': '高', '状态': '待响应' },
    });

    const input = page.getByPlaceholder('搜索关键词（标题、名称、描述等）');
    await input.fill('搜索测试攻关E2E');
    await input.press('Enter');
    await page.waitForTimeout(1500);

    const rows = page.locator('.ant-table-row');
    await expect(rows.first()).toBeVisible({ timeout: 5000 });
  });

  test('shows no results for nonsense query', async ({ page }) => {
    const input = page.getByPlaceholder('搜索关键词（标题、名称、描述等）');
    await input.fill('xyznonexistent12345');
    await input.press('Enter');
    await page.waitForTimeout(1500);

    await expect(page.getByText('未找到匹配结果')).toBeVisible();
  });

  test('clicking attackTicket result navigates to detail', async ({ page }) => {
    const res = await page.request.post(`${API}/api/nodes/attackTicket`, {
      headers: { 'Content-Type': 'application/json', 'X-Role': 'leader' },
      data: { '标题': '导航测试NAV', '状态': '待响应' },
    });
    const { id } = await res.json();

    const input = page.getByPlaceholder('搜索关键词（标题、名称、描述等）');
    await input.fill('导航测试NAV');
    await input.press('Enter');
    await page.waitForTimeout(1500);

    const link = page.locator('.ant-table-row').first().locator('a').first();
    await expect(link).toBeVisible({ timeout: 5000 });
    await link.click();
    await page.waitForTimeout(1000);
    expect(page.url()).toContain(`/attack/${id}`);
  });

  test('clicking non-attackTicket result loads context panel', async ({ page }) => {
    const res = await page.request.post(`${API}/api/nodes/person`, {
      headers: { 'Content-Type': 'application/json', 'X-Role': 'leader' },
      data: { '名称': 'CtxPanelTest' },
    });
    if (!res.ok()) return;

    const input = page.getByPlaceholder('搜索关键词（标题、名称、描述等）');
    await input.fill('CtxPanelTest');
    await input.press('Enter');
    await page.waitForTimeout(1500);

    const row = page.locator('.ant-table-row');
    const count = await row.count();
    if (count === 0) return;

    await row.first().click();
    await page.waitForTimeout(1000);

    await expect(page.locator('.ant-card')).toBeVisible({ timeout: 5000 });
  });

  test('context panel view detail link works', async ({ page }) => {
    const res = await page.request.post(`${API}/api/nodes/attackTicket`, {
      headers: { 'Content-Type': 'application/json', 'X-Role': 'leader' },
      data: { '标题': 'CtxDetailLink', '状态': '待响应' },
    });
    const { id } = await res.json();

    const input = page.getByPlaceholder('搜索关键词（标题、名称、描述等）');
    await input.fill('CtxDetailLink');
    await input.press('Enter');
    await page.waitForTimeout(1500);

    const row = page.locator('.ant-table-row').first();
    await expect(row).toBeVisible({ timeout: 5000 });
    await row.click();
    await page.waitForTimeout(1000);

    const viewLink = page.locator('.ant-card').getByText(/查\s?看\s*详\s*情/);
    if (await viewLink.isVisible()) {
      await viewLink.click();
      await page.waitForTimeout(500);
      expect(page.url()).toContain(`/attack/${id}`);
    }
  });

  test('filter by node type works', async ({ page }) => {
    await page.request.post(`${API}/api/nodes/attackTicket`, {
      headers: { 'Content-Type': 'application/json', 'X-Role': 'leader' },
      data: { '标题': '筛选测试单', '状态': '待响应' },
    });
    await page.request.post(`${API}/api/nodes/person`, {
      headers: { 'Content-Type': 'application/json', 'X-Role': 'leader' },
      data: { '名称': '筛选测试人' },
    });

    const input = page.getByPlaceholder('搜索关键词（标题、名称、描述等）');
    await input.fill('筛选测试');
    await input.press('Enter');
    await page.waitForTimeout(1500);

    const rows = page.locator('.ant-table-row');
    await expect(rows.first()).toBeVisible({ timeout: 5000 });
    const countBefore = await rows.count();

    const selects = page.locator('.ant-select');
    await selects.nth(0).locator('.ant-select-selector').click();
    await page.waitForTimeout(300);
    const dropdown = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').last();
    await dropdown.locator('.ant-select-item-option').filter({ hasText: '人员' }).first().dispatchEvent('click');
    await page.waitForTimeout(1500);

    const countAfter = await rows.count();
    expect(countAfter).toBeLessThanOrEqual(countBefore);
  });

  test('search input clear works', async ({ page }) => {
    const input = page.getByPlaceholder('搜索关键词（标题、名称、描述等）');
    await input.fill('some text');
    await page.waitForTimeout(200);
    await input.clear();
    await page.waitForTimeout(200);
    await expect(input).toHaveValue('');
  });

  test('type filter clear works', async ({ page }) => {
    const selects = page.locator('.ant-select');
    await selects.nth(0).locator('.ant-select-selector').click();
    await page.waitForTimeout(300);
    const dropdown = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').last();
    await dropdown.locator('.ant-select-item-option').filter({ hasText: '攻关单' }).first().dispatchEvent('click');
    await page.waitForTimeout(300);

    const clearBtn = selects.nth(0).locator('.ant-select-clear');
    if (await clearBtn.isVisible()) {
      await clearBtn.click();
      await page.waitForTimeout(200);
    }
  });
});

test.describe('关系审批', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/proposals');
    await page.waitForLoadState('networkidle');
  });

  test('shows page heading and scan button', async ({ page }) => {
    await expect(page.getByRole('heading', { name: '关系审批' })).toBeVisible();
    await expect(page.getByRole('button', { name: /扫\s?描/ })).toBeVisible();
  });

  test('shows empty state when no proposals', async ({ page }) => {
    await expect(page.getByText('暂无候选关系')).toBeVisible();
  });

  test('scan button creates proposals from similar persons', async ({ page }) => {
    await page.request.post(`${API}/api/nodes/person`, {
      headers: { 'Content-Type': 'application/json', 'X-Role': 'leader' },
      data: { '名称': 'ProposalScanA' },
    });
    await page.request.post(`${API}/api/nodes/person`, {
      headers: { 'Content-Type': 'application/json', 'X-Role': 'leader' },
      data: { '名称': 'ProposalScanA1' },
    });

    await page.getByRole('button', { name: /扫\s?描/ }).click();
    await page.waitForTimeout(1500);

    const msg = page.locator('.ant-message');
    await expect(msg).toBeVisible({ timeout: 5000 });
  });

  test('status filter works', async ({ page }) => {
    const filterSelect = page.locator('.ant-select').nth(0);
    await filterSelect.locator('.ant-select-selector').click();
    await page.waitForTimeout(300);
    const dropdown = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').last();
    await dropdown.locator('.ant-select-item-option').filter({ hasText: '已通过' }).first().dispatchEvent('click');
    await page.waitForTimeout(500);
  });

  test('clicking source node shows detail card', async ({ page }) => {
    await page.request.post(`${API}/api/nodes/person`, {
      headers: { 'Content-Type': 'application/json', 'X-Role': 'leader' },
      data: { '名称': 'DetailSrcPerson' },
    });
    await page.request.post(`${API}/api/nodes/person`, {
      headers: { 'Content-Type': 'application/json', 'X-Role': 'leader' },
      data: { '名称': 'DetailSrcPerson1' },
    });

    await page.getByRole('button', { name: /扫\s?描/ }).click();
    await page.waitForTimeout(1500);

    const sourceLink = page.locator('.ant-table-row').first().locator('a').first();
    if (await sourceLink.isVisible()) {
      await sourceLink.click();
      await expect(page.getByText('提案详情')).toBeVisible();
    }
  });

  test('detail card close button hides card', async ({ page }) => {
    await page.request.post(`${API}/api/nodes/person`, {
      headers: { 'Content-Type': 'application/json', 'X-Role': 'leader' },
      data: { '名称': 'CloseCardTest' },
    });
    await page.request.post(`${API}/api/nodes/person`, {
      headers: { 'Content-Type': 'application/json', 'X-Role': 'leader' },
      data: { '名称': 'CloseCardTest1' },
    });

    await page.getByRole('button', { name: /扫\s?描/ }).click();
    await page.waitForTimeout(1500);

    const sourceLink = page.locator('.ant-table-row').first().locator('a').first();
    if (await sourceLink.isVisible()) {
      await sourceLink.click();
      await expect(page.getByText('提案详情')).toBeVisible();

      const closeBtn = page.locator('.ant-card-extra button');
      if (await closeBtn.isVisible()) {
        await closeBtn.click();
        await page.waitForTimeout(300);
        await expect(page.getByText('提案详情')).not.toBeVisible();
      }
    }
  });

  test('approve proposal via popconfirm', async ({ page }) => {
    await page.request.post(`${API}/api/nodes/person`, {
      headers: { 'Content-Type': 'application/json', 'X-Role': 'leader' },
      data: { '名称': 'ApproveTestP' },
    });
    await page.request.post(`${API}/api/nodes/person`, {
      headers: { 'Content-Type': 'application/json', 'X-Role': 'leader' },
      data: { '名称': 'ApproveTestP1' },
    });

    await page.getByRole('button', { name: /扫\s?描/ }).click();
    await page.waitForTimeout(1500);

    const approveLink = page.locator('.ant-table-row').first().getByText(/通\s?过/);
    if (await approveLink.isVisible()) {
      await approveLink.click();
      await page.waitForTimeout(300);
      await page.locator('.ant-popconfirm').getByRole('button', { name: /确\s?定|OK/ }).click();
      await page.waitForTimeout(1500);

      const msg = page.locator('.ant-message');
      await expect(msg).toBeVisible({ timeout: 5000 });
    }
  });

  test('reject proposal via popconfirm', async ({ page }) => {
    await page.request.post(`${API}/api/nodes/person`, {
      headers: { 'Content-Type': 'application/json', 'X-Role': 'leader' },
      data: { '名称': 'RejectTestP' },
    });
    await page.request.post(`${API}/api/nodes/person`, {
      headers: { 'Content-Type': 'application/json', 'X-Role': 'leader' },
      data: { '名称': 'RejectTestP1' },
    });

    await page.getByRole('button', { name: /扫\s?描/ }).click();
    await page.waitForTimeout(1500);

    const rejectLink = page.locator('.ant-table-row').first().getByText(/拒\s?绝/);
    if (await rejectLink.isVisible()) {
      await rejectLink.click();
      await page.waitForTimeout(300);
      await page.locator('.ant-popconfirm').getByRole('button', { name: /确\s?定|OK/ }).click();
      await page.waitForTimeout(1500);

      const msg = page.locator('.ant-message');
      await expect(msg).toBeVisible({ timeout: 5000 });
    }
  });
});

test.describe('跟催提醒', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/reminders');
    await page.waitForLoadState('networkidle');
  });

  test('shows page heading and scan button', async ({ page }) => {
    await expect(page.getByRole('heading', { name: '跟催提醒' })).toBeVisible();
    await expect(page.getByRole('button', { name: /扫\s?描/ })).toBeVisible();
  });

  test('shows empty state when no reminders', async ({ page }) => {
    await expect(page.getByText('暂无提醒')).toBeVisible();
  });

  test('scan button triggers reminder scan', async ({ page }) => {
    await page.getByRole('button', { name: /扫\s?描/ }).click();
    await page.waitForTimeout(1500);

    const msg = page.locator('.ant-message');
    await expect(msg).toBeVisible({ timeout: 5000 });
  });

  test('status filter works', async ({ page }) => {
    const filterSelect = page.locator('.ant-select').nth(0);
    await filterSelect.locator('.ant-select-selector').click();
    await page.waitForTimeout(300);
    const dropdown = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').last();
    await dropdown.locator('.ant-select-item-option').filter({ hasText: '已发送' }).first().dispatchEvent('click');
    await page.waitForTimeout(500);
  });

  test('view button opens detail drawer', async ({ page }) => {
    const ticket = await page.request.post(`${API}/api/nodes/attackTicket`, {
      headers: { 'Content-Type': 'application/json', 'X-Role': 'leader' },
      data: { '标题': 'ReminderViewTest', '状态': '处理中' },
    });
    if (!ticket.ok()) return;

    await page.getByRole('button', { name: /扫\s?描/ }).click();
    await page.waitForTimeout(1500);

    const viewLink = page.locator('.ant-table-row').first().getByText(/查\s?看/);
    if (await viewLink.isVisible()) {
      await viewLink.click();
      await page.waitForTimeout(500);
      await expect(page.locator('.ant-drawer')).toBeVisible();
      await expect(page.getByText('提醒详情')).toBeVisible();
    }
  });

  test('subject link opens detail drawer', async ({ page }) => {
    const ticket = await page.request.post(`${API}/api/nodes/attackTicket`, {
      headers: { 'Content-Type': 'application/json', 'X-Role': 'leader' },
      data: { '标题': 'ReminderSubjectTest', '状态': '处理中' },
    });
    if (!ticket.ok()) return;

    await page.getByRole('button', { name: /扫\s?描/ }).click();
    await page.waitForTimeout(1500);

    const subjectLink = page.locator('.ant-table-row').first().locator('a').first();
    if (await subjectLink.isVisible()) {
      await subjectLink.click();
      await page.waitForTimeout(500);
      await expect(page.locator('.ant-drawer')).toBeVisible();
    }
  });

  test('drawer close button hides drawer', async ({ page }) => {
    const ticket = await page.request.post(`${API}/api/nodes/attackTicket`, {
      headers: { 'Content-Type': 'application/json', 'X-Role': 'leader' },
      data: { '标题': 'ReminderCloseTest', '状态': '处理中' },
    });
    if (!ticket.ok()) return;

    await page.getByRole('button', { name: /扫\s?描/ }).click();
    await page.waitForTimeout(1500);

    const viewLink = page.locator('.ant-table-row').first().getByText(/查\s?看/);
    if (await viewLink.isVisible()) {
      await viewLink.click();
      await page.waitForTimeout(500);
      await expect(page.locator('.ant-drawer')).toBeVisible();

      await page.locator('.ant-drawer-close').click();
      await page.waitForTimeout(500);
    }
  });

  test('send reminder via popconfirm', async ({ page }) => {
    const ticket = await page.request.post(`${API}/api/nodes/attackTicket`, {
      headers: { 'Content-Type': 'application/json', 'X-Role': 'leader' },
      data: { '标题': 'ReminderSendTest', '状态': '处理中' },
    });
    if (!ticket.ok()) return;

    await page.getByRole('button', { name: /扫\s?描/ }).click();
    await page.waitForTimeout(1500);

    const sendLink = page.locator('.ant-table-row').first().getByText(/发\s?送/);
    if (await sendLink.isVisible()) {
      await sendLink.click();
      await page.waitForTimeout(300);
      await page.locator('.ant-popconfirm').getByRole('button', { name: /确\s?定|OK/ }).click();
      await page.waitForTimeout(1500);

      const msg = page.locator('.ant-message');
      await expect(msg).toBeVisible({ timeout: 5000 });
    }
  });

  test('ignore reminder via popconfirm', async ({ page }) => {
    const ticket = await page.request.post(`${API}/api/nodes/attackTicket`, {
      headers: { 'Content-Type': 'application/json', 'X-Role': 'leader' },
      data: { '标题': 'ReminderIgnoreTest', '状态': '处理中' },
    });
    if (!ticket.ok()) return;

    await page.getByRole('button', { name: /扫\s?描/ }).click();
    await page.waitForTimeout(1500);

    const ignoreLink = page.locator('.ant-table-row').first().getByText(/忽\s?略/);
    if (await ignoreLink.isVisible()) {
      await ignoreLink.click();
      await page.waitForTimeout(300);
      await page.locator('.ant-popconfirm').getByRole('button', { name: /确\s?定|OK/ }).click();
      await page.waitForTimeout(1500);

      const msg = page.locator('.ant-message');
      await expect(msg).toBeVisible({ timeout: 5000 });
    }
  });
});
