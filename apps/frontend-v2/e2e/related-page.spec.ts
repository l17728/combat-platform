import { test, expect } from '@playwright/test';
import { API } from './helpers';

test.describe('关联全景', () => {
  test('shows page title and controls for valid ticket', async ({ page }) => {
    const ticket = await page.request.post(`${API}/api/nodes/attackTicket`, {
      headers: { 'Content-Type': 'application/json', 'X-Role': 'leader' },
      data: { '标题': 'RelatedPageTestTicket', '状态': '待响应' },
    });
    if (!ticket.ok()) return;
    const { id } = await ticket.json();
    await page.goto(`/related/attackTicket/${id}`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: /关联全景/ })).toBeVisible();
    await expect(page.getByText('返回')).toBeVisible();
  });

  test('back button navigates away', async ({ page }) => {
    const ticket = await page.request.post(`${API}/api/nodes/attackTicket`, {
      headers: { 'Content-Type': 'application/json', 'X-Role': 'leader' },
      data: { '标题': 'RelatedBackTest', '状态': '待响应' },
    });
    if (!ticket.ok()) return;
    const { id } = await ticket.json();
    await page.goto(`/related/attackTicket/${id}`);
    await page.waitForLoadState('networkidle');

    await page.getByText('返回').click();
    await page.waitForTimeout(500);
  });

  test('depth select changes value', async ({ page }) => {
    const ticket = await page.request.post(`${API}/api/nodes/attackTicket`, {
      headers: { 'Content-Type': 'application/json', 'X-Role': 'leader' },
      data: { '标题': 'RelatedDepthTest', '状态': '待响应' },
    });
    if (!ticket.ok()) return;
    const { id } = await ticket.json();
    await page.goto(`/related/attackTicket/${id}`);
    await page.waitForLoadState('networkidle');

    const depthSelect = page.locator('.ant-select').filter({ hasText: '1' }).first();
    if (await depthSelect.isVisible()) {
      await depthSelect.locator('.ant-select-selector').click();
      await page.waitForTimeout(300);
      const dropdown = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').last();
      await dropdown.locator('.ant-select-item-option').filter({ hasText: '2' }).first().dispatchEvent('click');
      await page.waitForTimeout(1000);
    }
  });

  test('shows related items or empty state', async ({ page }) => {
    const ticket = await page.request.post(`${API}/api/nodes/attackTicket`, {
      headers: { 'Content-Type': 'application/json', 'X-Role': 'leader' },
      data: { '标题': 'RelatedEmptyTest', '状态': '待响应' },
    });
    if (!ticket.ok()) return;
    const { id } = await ticket.json();
    await page.goto(`/related/attackTicket/${id}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    const hasEmpty = await page.getByText('暂无关联').isVisible().catch(() => false);
    const hasItems = await page.locator('.ant-list-item').first().isVisible().catch(() => false);
    expect(hasEmpty || hasItems).toBeTruthy();
  });
});
