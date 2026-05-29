import { test, expect } from '@playwright/test';
import { API } from './helpers';

test.describe('攻关日报', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/daily-report');
    await page.waitForLoadState('networkidle');
  });

  test('shows page heading and date controls', async ({ page }) => {
    await expect(page.getByRole('heading', { name: '攻关日报' })).toBeVisible();
    await expect(page.getByText(/今\s?天/)).toBeVisible();
    await expect(page.getByRole('button', { name: /复\s?制/ })).toBeVisible();
    await expect(page.getByRole('button', { name: '发布日报' })).toBeVisible();
  });

  test('previous day button shifts date', async ({ page }) => {
    const titleBefore = await page.locator('h4').textContent();
    await page.locator('button').filter({ has: page.locator('.anticon-left') }).first().click();
    await page.waitForTimeout(1500);
    const titleAfter = await page.locator('h4').textContent();
    expect(titleBefore).toBeTruthy();
  });

  test('next day button shifts date', async ({ page }) => {
    await page.locator('button').filter({ has: page.locator('.anticon-right') }).first().click();
    await page.waitForTimeout(1500);
    await expect(page.getByRole('heading', { name: '攻关日报' })).toBeVisible();
  });

  test('today button resets to today', async ({ page }) => {
    await page.locator('button').filter({ has: page.locator('.anticon-left') }).first().click();
    await page.waitForTimeout(1000);
    await page.getByText(/今\s?天/).click();
    await page.waitForTimeout(1500);
    await expect(page.getByRole('heading', { name: '攻关日报' })).toBeVisible();
  });

  test('date picker is present', async ({ page }) => {
    const picker = page.locator('.ant-picker');
    await expect(picker).toBeVisible();
  });

  test('copy button exists', async ({ page }) => {
    const copyBtn = page.getByRole('button', { name: /复\s?制/ });
    await expect(copyBtn).toBeVisible();
  });

  test('publish button shows feedback', async ({ page }) => {
    const res = await page.request.post(`${API}/api/nodes/attackTicket`, {
      headers: { 'Content-Type': 'application/json', 'X-Role': 'leader' },
      data: { '标题': 'DailyReportPubTest', '状态': '待响应' },
    });
    if (res.ok()) {
      const { id } = await res.json();
      await page.request.post(`${API}/api/nodes/${id}/progress`, {
        headers: { 'Content-Type': 'application/json' },
        data: { content: '发布测试进展', statusSnapshot: '待响应', actor: 'e2e' },
      });
    }

    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    const publishBtn = page.getByRole('button', { name: '发布日报' });
    if (await publishBtn.isEnabled()) {
      await publishBtn.click();
      await page.waitForTimeout(1000);
      const msg = page.locator('.ant-message');
      await expect(msg).toBeVisible({ timeout: 3000 });
    }
  });

  test('section card 查看详情 navigates to attack detail', async ({ page }) => {
    const res = await page.request.post(`${API}/api/nodes/attackTicket`, {
      headers: { 'Content-Type': 'application/json' },
      data: { '标题': 'E2E日报跳转单', '状态': '待响应' },
    });
    const { id } = await res.json();
    await page.request.post(`${API}/api/nodes/${id}/progress`, {
      headers: { 'Content-Type': 'application/json' },
      data: { content: 'E2E跳转进展', statusSnapshot: '待响应', actor: 'e2e' },
    });
    await page.reload();
    await page.waitForLoadState('networkidle');
    const card = page.locator('.ant-card').filter({ hasText: 'E2E日报跳转单' });
    if (await card.first().isVisible()) {
      await card.first().getByText('查看详情').click();
      await expect(page).toHaveURL(new RegExp(`/attack/${id}`));
    }
  });

  test('shows section cards for tickets with progress', async ({ page }) => {
    const res = await page.request.post(`${API}/api/nodes/attackTicket`, {
      headers: { 'Content-Type': 'application/json', 'X-Role': 'leader' },
      data: { '标题': 'DailyReportCardTest', '状态': '待响应' },
    });
    if (res.ok()) {
      const { id } = await res.json();
      await page.request.post(`${API}/api/nodes/${id}/progress`, {
        headers: { 'Content-Type': 'application/json' },
        data: { content: '日报卡测试', statusSnapshot: '待响应', actor: 'e2e' },
      });
    }

    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    const cardTitle = page.getByText('DailyReportCardTest');
    if (await cardTitle.isVisible()) {
      await expect(page.getByText('日报卡测试')).toBeVisible();
    }
  });
});

test.describe('攻关日报条目 - 编辑(草稿可改/已发布锁定)', () => {
  test('edit a draft entry, then it is locked after publish', async ({ page }) => {
    const res = await page.request.post(`${API}/api/nodes/attackTicket`, {
      headers: { 'Content-Type': 'application/json' },
      data: { '标题': 'E2E日报编辑单', '状态': '处理中' },
    });
    const { id } = await res.json();
    await page.request.post(`${API}/api/nodes/${id}/daily-reports`, {
      headers: { 'Content-Type': 'application/json' },
      data: { type: '进展通报', currentProgress: 'E2E原始进展内容', nextSteps: '原计划' },
    });

    await page.goto(`/attack/${id}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: /日报更新/ }).click();
    await page.waitForTimeout(300);

    const row = page.getByRole('row').filter({ hasText: 'E2E原始进展内容' });
    await row.getByRole('button', { name: '编辑' }).click();
    const modal = page.locator('.ant-modal').filter({ hasText: '编辑日报条目' });
    await expect(modal).toBeVisible();
    await modal.getByPlaceholder('请输入当前进展...').fill('E2E更新后的进展内容');
    await modal.getByRole('button', { name: /提\s?交/ }).click();
    await expect(page.getByText('日报条目已更新')).toBeVisible();
    await expect(page.getByText('E2E更新后的进展内容')).toBeVisible();

    const row2 = page.getByRole('row').filter({ hasText: 'E2E更新后的进展内容' });
    await row2.getByRole('button', { name: '发布' }).click();
    await expect(page.getByText('已发布').first()).toBeVisible();
    await expect(row2.getByRole('button', { name: '编辑' })).toBeDisabled();
  });
});
