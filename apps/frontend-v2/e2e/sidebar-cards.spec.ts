import { test, expect } from '@playwright/test';
import { API } from './helpers';

function sidebarCard(title: string) {
  return page => page.locator('.ant-col-6 .ant-card').filter({ hasText: new RegExp(title) });
}

test.describe('攻击详情 - 侧边栏卡片面板', () => {
  let ticketId: string;

  test.beforeEach(async ({ page, request }) => {
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

  test('default team panel is visible on page load', async ({ page }) => {
    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');
    await expect(sidebarCard('攻关成员')(page)).toBeVisible();
  });

  test('click panel button opens popover with checkbox options', async ({ page }) => {
    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /面板/ }).click();

    const popover = page.locator('.ant-popover:not(.ant-popover-hidden)');
    await expect(popover).toBeVisible();
    await expect(popover.getByText('找帮手推荐')).toBeVisible();
    await expect(popover.getByText('攻关成员')).toBeVisible();
  });

  test('unchecking panel checkbox hides the panel', async ({ page }) => {
    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');

    await expect(sidebarCard('攻关成员')(page)).toBeVisible();

    await page.getByRole('button', { name: /面板/ }).click();
    const popover = page.locator('.ant-popover:not(.ant-popover-hidden)');
    await expect(popover).toBeVisible();

    await popover.locator('.ant-checkbox-wrapper').filter({ hasText: '攻关成员' }).click();

    await expect(sidebarCard('攻关成员')(page)).not.toBeVisible({ timeout: 5000 });
  });

  test('re-checking panel checkbox shows the panel again', async ({ page }) => {
    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /面板/ }).click();
    const popover = page.locator('.ant-popover:not(.ant-popover-hidden)');
    await expect(popover).toBeVisible();

    await popover.locator('.ant-checkbox-wrapper').filter({ hasText: '攻关成员' }).click();
    await expect(sidebarCard('攻关成员')(page)).not.toBeVisible({ timeout: 5000 });

    await popover.locator('.ant-checkbox-wrapper').filter({ hasText: '攻关成员' }).click();
    await expect(sidebarCard('攻关成员')(page)).toBeVisible({ timeout: 5000 });
  });

  test('close button on card removes that panel', async ({ page }) => {
    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');

    const teamCard = sidebarCard('攻关成员')(page);
    await expect(teamCard).toBeVisible();

    const closeBtn = teamCard.locator('.ant-card-extra').locator('button').filter({ has: page.locator('.anticon-close') });
    await closeBtn.click();

    await expect(sidebarCard('攻关成员')(page)).not.toBeVisible({ timeout: 5000 });
  });

  test('main content expands when all panels are hidden', async ({ page }) => {
    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /面板/ }).click();
    const popover = page.locator('.ant-popover:not(.ant-popover-hidden)');
    await expect(popover).toBeVisible();

    await popover.locator('.ant-checkbox-wrapper').filter({ hasText: '攻关成员' }).click();
    await popover.locator('.ant-checkbox-wrapper').filter({ hasText: '找帮手推荐' }).click();

    await expect(page.locator('.ant-col-24')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.ant-col-6')).not.toBeVisible();
  });
});
