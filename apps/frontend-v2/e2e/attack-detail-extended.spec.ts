import { test, expect } from '@playwright/test';
import { API, selectOption, waitForDrawer, waitForTable } from './helpers';

function btn(name: string) {
  return { name: new RegExp(name.split('').join('\\s?')) };
}

test.describe('攻击详情 - 扩展功能', () => {
  let ticketId: string;

  test.beforeEach(async ({ page }) => {
    const res = await page.request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E扩展功能测试', 状态: '待响应' },
    });
    const ticket = await res.json();
    ticketId = ticket.id;
  });

  test.describe('日报更新 tab', () => {
    test('navigates to daily report tab', async ({ page }) => {
      await page.goto(`/attack/${ticketId}`);
      await page.waitForLoadState('networkidle');
      await page.getByRole('tab', { name: /日报更新/ }).click();
      await expect(page.getByRole('button', btn('创建'))).toBeVisible();
      await expect(page.getByText('暂无日报条目')).toBeVisible();
    });

    test('create daily report entry', async ({ page }) => {
      await page.goto(`/attack/${ticketId}`);
      await page.waitForLoadState('networkidle');
      await page.getByRole('tab', { name: /日报更新/ }).click();
      await page.getByRole('button', btn('创建')).click();

      const modal = page.locator('.ant-modal').filter({ hasText: '创建日报条目' });
      await expect(modal).toBeVisible();

      await modal.getByPlaceholder('请输入当前进展...').fill('E2E测试当前进展内容');
      await modal.getByPlaceholder('请输入下一步计划...').fill('E2E测试下一步计划');
      await modal.getByRole('button', btn('提交')).click();

      await expect(page.getByText('日报条目已创建').first()).toBeVisible({ timeout: 10000 });
    });

    test('daily report requires current progress', async ({ page }) => {
      await page.goto(`/attack/${ticketId}`);
      await page.waitForLoadState('networkidle');
      await page.getByRole('tab', { name: /日报更新/ }).click();
      await page.getByRole('button', btn('创建')).click();

      const modal = page.locator('.ant-modal').filter({ hasText: '创建日报条目' });
      await modal.getByRole('button', btn('提交')).click();

      await expect(page.getByText('当前进展必填')).toBeVisible();
    });

    test('publish daily report entry', async ({ page }) => {
      await page.request.post(`${API}/api/nodes/${ticketId}/daily-reports`, {
        data: { type: '进展通报', currentProgress: 'E2E待发布进展' },
      });
      await page.goto(`/attack/${ticketId}`);
      await page.waitForLoadState('networkidle');
      await page.getByRole('tab', { name: /日报更新/ }).click();
      await page.waitForTimeout(500);

      await expect(page.getByText('E2E待发布进展')).toBeVisible({ timeout: 10000 });
      const row = page.getByRole('row').filter({ hasText: 'E2E待发布进展' });
      await row.getByRole('button', btn('发布')).click();

      await expect(page.getByText('已发布').first()).toBeVisible({ timeout: 10000 });
    });

    test('delete daily report entry', async ({ page }) => {
      await page.request.post(`${API}/api/nodes/${ticketId}/daily-reports`, {
        data: { type: '进展通报', currentProgress: 'E2E待删除进展' },
      });
      await page.goto(`/attack/${ticketId}`);
      await page.waitForLoadState('networkidle');
      await page.getByRole('tab', { name: /日报更新/ }).click();
      await page.waitForTimeout(500);

      await expect(page.getByText('E2E待删除进展')).toBeVisible({ timeout: 10000 });
      const row = page.getByRole('row').filter({ hasText: 'E2E待删除进展' });
      await row.getByRole('button', btn('删除')).click();

      await expect(page.getByText('E2E待删除进展')).not.toBeVisible({ timeout: 10000 });
    });

    test('view daily report detail', async ({ page }) => {
      await page.request.post(`${API}/api/nodes/${ticketId}/daily-reports`, {
        data: { type: '风险通报', currentProgress: 'E2E详情测试进展', nextSteps: 'E2E详情下一步' },
      });
      await page.goto(`/attack/${ticketId}`);
      await page.waitForLoadState('networkidle');
      await page.getByRole('tab', { name: /日报更新/ }).click();
      await page.waitForTimeout(500);

      await expect(page.getByText('E2E详情测试进展')).toBeVisible({ timeout: 10000 });
      const row = page.getByRole('row').filter({ hasText: 'E2E详情测试进展' });
      await row.getByRole('button', btn('详情')).click();

      const detailModal = page.locator('.ant-modal').filter({ hasText: '日报条目详情' });
      await expect(detailModal).toBeVisible();
      await expect(detailModal.getByText('风险通报')).toBeVisible();
    });
  });

  test.describe('求助网络 tab', () => {
    test('navigates to support network tab', async ({ page }) => {
      await page.goto(`/attack/${ticketId}`);
      await page.waitForLoadState('networkidle');
      await page.getByRole('tab', { name: /求助网络/ }).click();
      await expect(page.getByRole('button', btn('添加节点'))).toBeVisible();
      await expect(page.getByText('暂无求助节点')).toBeVisible();
    });

    test('add support node', async ({ page }) => {
      await page.goto(`/attack/${ticketId}`);
      await page.waitForLoadState('networkidle');
      await page.getByRole('tab', { name: /求助网络/ }).click();
      await page.getByRole('button', btn('添加节点')).click();

      const modal = page.locator('.ant-modal').filter({ hasText: '添加求助节点' });
      await expect(modal).toBeVisible();

      const selects = modal.locator('.ant-select');
      await selectOption(page, selects.nth(1), '环境');
      await modal.getByPlaceholder('请输入具体领域').fill('E2E测试领域');

      await modal.getByRole('button', btn('提交')).click();
      await expect(page.getByText('节点已添加').first()).toBeVisible({ timeout: 10000 });
    });

    test('click node shows person detail panel (basic info + KG relations header)', async ({ page }) => {
      await page.request.post(`${API}/api/nodes/person`, { data: { 姓名: 'E2E求助负责人', 部门: '应急部', 邮箱: 'oncall@x.com' } });
      const tRes = await page.request.post(`${API}/api/nodes/attackTicket`, { data: { 标题: 'E2E求助详情单', 状态: '处理中', 当前处理人: 'E2E求助负责人' } });
      const t = await tRes.json();
      await page.request.post(`${API}/api/support-nodes/${t.id}`, { data: { category: '环境', domain: '网络抓包', personName: 'E2E求助负责人', status: '待确认' } });

      await page.goto(`/attack/${t.id}`);
      await page.waitForLoadState('networkidle');
      await page.getByRole('tab', { name: /求助网络/ }).click();
      await page.locator('.ant-tree').getByText('E2E求助负责人').first().click();

      await expect(page.getByText('应急部')).toBeVisible();
      await expect(page.getByText('知识图谱关联（一跳）')).toBeVisible();
    });

    test('support node requires category and domain', async ({ page }) => {
      await page.goto(`/attack/${ticketId}`);
      await page.waitForLoadState('networkidle');
      await page.getByRole('tab', { name: /求助网络/ }).click();
      await page.getByRole('button', btn('添加节点')).click();

      const modal = page.locator('.ant-modal').filter({ hasText: '添加求助节点' });
      await modal.getByRole('button', btn('提交')).click();

      await expect(page.getByText('请选择大类')).toBeVisible();
      await expect(page.getByText('请输入具体领域')).toBeVisible();
    });

    test('delete support node', async ({ page }) => {
      const snRes = await page.request.post(`${API}/api/support-nodes/${ticketId}`, {
        data: { category: '环境', domain: 'E2E待删除领域', status: '待确认' },
      });
      expect(snRes.ok()).toBeTruthy();
      const sn = await snRes.json();

      await page.goto(`/attack/${ticketId}`);
      await page.waitForLoadState('networkidle');
      await page.getByRole('tab', { name: /求助网络/ }).click();
      await page.waitForTimeout(500);

      await expect(page.getByText('E2E待删除领域')).toBeVisible({ timeout: 10000 });

      await page.request.delete(`${API}/api/support-nodes/node/${sn.id}`);
      await page.reload();
      await page.waitForLoadState('networkidle');
      await page.getByRole('tab', { name: /求助网络/ }).click();
      await page.waitForTimeout(500);

      await expect(page.getByText('E2E待删除领域')).not.toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('关联全景 link', () => {
    test('navigates to related page via button', async ({ page }) => {
      await page.goto(`/attack/${ticketId}`);
      await page.waitForLoadState('networkidle');
      const relatedBtn = page.getByRole('link', { name: /关联全景/ });
      await expect(relatedBtn).toBeVisible();
      await relatedBtn.click();
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveURL(new RegExp(`/related/attackTicket/${ticketId}`));
    });
  });

  test.describe('状态流转 with note', () => {
    test('status transition with note', async ({ page }) => {
      await page.goto(`/attack/${ticketId}`);
      await page.waitForLoadState('networkidle');
      await page.getByRole('button', { name: '状态流转' }).click();
      await waitForDrawer(page);

      const drawer = page.locator('.ant-drawer');
      await expect(drawer.getByText('当前状态：')).toBeVisible();

      const statusSelect = drawer.locator('.ant-select').first();
      await selectOption(page, statusSelect, '处理中');

      await drawer.getByPlaceholder('状态变更原因...').fill('E2E测试流转备注');
      await drawer.getByRole('button', { name: '确认流转' }).click();

      await expect(page.getByText('状态流转成功').first()).toBeVisible({ timeout: 10000 });
    });
  });
});
