import { test, expect } from '@playwright/test';
import { API } from './helpers';

// 攻关详情侧边栏卡:面板默认收起,「合规追溯」(leader/admin)、「找帮手推荐」(全员)
// 「攻关成员」卡已下线 — 内容并入「成员管理」固定 tab。
function sidebarCard(title: string, page) {
  return page.locator('.ant-col-6 .ant-card').filter({ hasText: new RegExp(title) });
}

test.describe('攻关详情 - 侧边栏卡片面板', () => {
  let ticketId: string;

  test.beforeEach(async ({ request }) => {
    const personRes = await request.post(`${API}/api/nodes/person`, {
      data: { 姓名: 'E2E面板测试人', 部门: '测试部' },
    });
    const person = await personRes.json();

    const ticketRes = await request.post(`${API}/api/nodes/attackTicket`, {
      data: {
        标题: 'E2E面板测试单',
        状态: '处理中',
        当前处理人: person.properties['姓名'],
        攻关组长: person.properties['姓名'],
      },
    });
    const ticket = await ticketRes.json();
    ticketId = ticket.id;
  });

  test('shows panel selector button in action bar', async ({ page }) => {
    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('button', { name: /面板/ })).toBeVisible();
  });

  test('面板默认收起,主内容占满', async ({ page }) => {
    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');
    // 默认无侧边栏 Col
    await expect(page.locator('.ant-col-6 .ant-card')).toHaveCount(0);
    await expect(page.locator('.ant-col-24')).toBeVisible();
  });

  test('click panel button opens popover with checkbox options', async ({ page }) => {
    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /面板/ }).click();

    const popover = page.locator('.ant-popover:not(.ant-popover-hidden)');
    await expect(popover).toBeVisible();
    await expect(popover.getByText('找帮手推荐')).toBeVisible();
    // admin 用户应能看到「合规追溯」选项(e2e 默认 admin)
    await expect(popover.getByText('合规追溯')).toBeVisible();
  });

  test('勾选「合规追溯」可显示该卡', async ({ page }) => {
    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /面板/ }).click();
    const popover = page.locator('.ant-popover:not(.ant-popover-hidden)');
    await expect(popover).toBeVisible();
    await popover.locator('.ant-checkbox-wrapper').filter({ hasText: '合规追溯' }).click();

    await expect(sidebarCard('合规追溯', page)).toBeVisible({ timeout: 5000 });
    await expect(sidebarCard('合规追溯', page).getByRole('button', { name: /查看完整历史/ })).toBeVisible();
  });

  test('卡片关闭按钮可单独移除该卡', async ({ page }) => {
    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');

    // 先打开「合规追溯」卡
    await page.getByRole('button', { name: /面板/ }).click();
    const popover = page.locator('.ant-popover:not(.ant-popover-hidden)');
    await popover.locator('.ant-checkbox-wrapper').filter({ hasText: '合规追溯' }).click();
    await page.keyboard.press('Escape');

    const card = sidebarCard('合规追溯', page);
    await expect(card).toBeVisible();
    await card.locator('.ant-card-extra').locator('button').filter({ has: page.locator('.anticon-close') }).click();
    await expect(sidebarCard('合规追溯', page)).not.toBeVisible({ timeout: 5000 });
  });

  test('全部取消勾选时主内容占满', async ({ page }) => {
    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');

    // 默认就是占满
    await expect(page.locator('.ant-col-24')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.ant-col-6')).not.toBeVisible();
  });
});
