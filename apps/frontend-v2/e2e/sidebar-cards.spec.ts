import { test, expect } from '@playwright/test';
import { API } from './helpers';

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

  test('default panels are visible on page load', async ({ page }) => {
    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.ant-card').filter({ hasText: '攻关成员' })).toBeVisible();
  });

  test('click panel button opens popover with checkbox options', async ({ page }) => {
    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /面板/ }).click();
    await expect(page.locator('.ant-popover')).toBeVisible();
    await expect(page.locator('.ant-popover .ant-checkbox-wrapper').filter({ hasText: '找帮手推荐' })).toBeVisible();
    await expect(page.locator('.ant-popover .ant-checkbox-wrapper').filter({ hasText: '攻关成员' })).toBeVisible();
  });

  test('unchecking panel checkbox hides the panel', async ({ page }) => {
    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.ant-card').filter({ hasText: '攻关成员' })).toBeVisible();

    await page.getByRole('button', { name: /面板/ }).click();
    await expect(page.locator('.ant-popover')).toBeVisible();

    await page.locator('.ant-popover .ant-checkbox-wrapper').filter({ hasText: '攻关成员' }).click();

    await expect(page.locator('.ant-card').filter({ hasText: '攻关成员' })).not.toBeVisible();
  });

  test('re-checking panel checkbox shows the panel again', async ({ page }) => {
    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /面板/ }).click();
    await expect(page.locator('.ant-popover')).toBeVisible();

    await page.locator('.ant-popover .ant-checkbox-wrapper').filter({ hasText: '攻关成员' }).click();
    await expect(page.locator('.ant-card').filter({ hasText: '攻关成员' })).not.toBeVisible();

    await page.locator('.ant-popover .ant-checkbox-wrapper').filter({ hasText: '攻关成员' }).click();
    await expect(page.locator('.ant-card').filter({ hasText: '攻关成员' })).toBeVisible();
  });

  test('close button on card removes that panel', async ({ page }) => {
    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');

    const teamCard = page.locator('.ant-card').filter({ hasText: '攻关成员' });
    await expect(teamCard).toBeVisible();

    const closeBtn = teamCard.locator('.ant-card-extra button[aria-label="close"], .ant-card-extra .anticon-close').first();
    if (await closeBtn.count() === 0) {
      const allCloseBtns = teamCard.locator('button').filter({ has: page.locator('.anticon-close') });
      await allCloseBtns.first().click();
    } else {
      await closeBtn.click();
    }

    await expect(page.locator('.ant-card').filter({ hasText: '攻关成员' })).not.toBeVisible();
  });

  test('main content expands when all panels are hidden', async ({ page }) => {
    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /面板/ }).click();
    await expect(page.locator('.ant-popover')).toBeVisible();

    await page.locator('.ant-popover .ant-checkbox-wrapper').filter({ hasText: '攻关成员' }).click();
    await page.locator('.ant-popover .ant-checkbox-wrapper').filter({ hasText: '找帮手推荐' }).click();

    const mainCol = page.locator('.ant-col-24').filter({ has: page.locator('.ant-tabs') });
    await expect(mainCol).toBeVisible();
  });
});
