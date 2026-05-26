import { test, expect } from '@playwright/test';
import { waitForTable } from './helpers';

async function findHelpButton(page: import('@playwright/test').Page) {
  const byTestId = page.locator('[data-testid="page-help-btn"]').first();
  if (await byTestId.isVisible({ timeout: 3000 })) return byTestId;
  const byAriaLabel = page.locator('button').filter({ has: page.locator('.anticon-question-circle') }).first();
  if (await byAriaLabel.isVisible({ timeout: 2000 })) return byAriaLabel;
  return byTestId;
}

const PAGES_WITH_HELP: Array<{ path: string; heading: string; helpTitle: string }> = [
  { path: '/attack', heading: '攻关作战台', helpTitle: '攻关作战台 - 使用帮助' },
  { path: '/people', heading: '全员名单', helpTitle: '全员名单 - 使用帮助' },
  { path: '/contributions', heading: '贡献录入', helpTitle: '贡献录入 - 使用帮助' },
  { path: '/honor', heading: '荣誉殿堂', helpTitle: '荣誉殿堂 - 使用帮助' },
  { path: '/search', heading: '全局搜索', helpTitle: '全局搜索 - 使用帮助' },
  { path: '/proposals', heading: '关系审批', helpTitle: '关系审批 - 使用帮助' },
  { path: '/reminders', heading: '跟催提醒', helpTitle: '跟催提醒 - 使用帮助' },
  { path: '/daily-report', heading: '攻关日报', helpTitle: '攻关日报 - 使用帮助' },
  { path: '/bug-report', heading: '问题反馈', helpTitle: '问题反馈 - 使用帮助' },
  { path: '/merge', heading: '人员合并', helpTitle: '人员合并 - 使用帮助' },
  { path: '/schema', heading: '表结构管理', helpTitle: '表结构管理 - 使用帮助' },
];

test.describe('帮助按钮', () => {
  for (const p of PAGES_WITH_HELP) {
    test(`${p.heading} - 帮助按钮打开帮助弹窗`, async ({ page }) => {
      await test.step(`导航到 ${p.path}`, async () => {
        await page.goto(p.path);
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(1000);
      });

      await test.step('点击帮助按钮', async () => {
        const helpBtn = await findHelpButton(page);
        await expect(helpBtn).toBeVisible({ timeout: 10000 });
        await helpBtn.click();
      });

      await test.step('验证帮助弹窗内容', async () => {
        const modal = page.locator('.ant-modal');
        await expect(modal).toBeVisible();
        await expect(modal.getByText(p.helpTitle)).toBeVisible();
      });

      await test.step('关闭弹窗', async () => {
        await page.locator('.ant-modal .ant-modal-close').click();
        await expect(page.locator('.ant-modal')).not.toBeVisible();
      });
    });
  }

  test('攻击详情页 - 帮助按钮', async ({ page, request }) => {
    const res = await request.post('http://localhost:3001/api/nodes/attackTicket', {
      data: { 标题: 'E2E帮助按钮测试', 状态: '处理中' },
    });
    const ticket = await res.json();

    await page.goto(`/attack/${ticket.id}`);
    const helpBtn = await findHelpButton(page);
    await expect(helpBtn).toBeVisible({ timeout: 10000 });
    await helpBtn.click();

    const modal = page.locator('.ant-modal');
    await expect(modal).toBeVisible();
    await expect(modal.getByText('攻关详情 - 使用帮助')).toBeVisible();
    await modal.locator('.ant-modal-close').click();
  });

  test('帮助按钮弹窗内容包含操作指南', async ({ page }) => {
    await page.goto('/people');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    const helpBtn = await findHelpButton(page);
    await helpBtn.click();
    const modal = page.locator('.ant-modal');
    await expect(modal).toBeVisible();
    await expect(modal.getByText('操作指南')).toBeVisible();
    await modal.locator('.ant-modal-close').click();
  });

  test('帮助按钮弹窗内容包含注意事项', async ({ page }) => {
    await page.goto('/attack');
    await waitForTable(page);

    const helpBtn = await findHelpButton(page);
    await helpBtn.click();
    const modal = page.locator('.ant-modal');
    await expect(modal).toBeVisible();
    await expect(modal.getByText('注意事项')).toBeVisible();
    await modal.locator('.ant-modal-close').click();
  });

  test('个人荣誉页面帮助按钮', async ({ page, request }) => {
    await request.post('http://localhost:3001/api/nodes/contribution', {
      data: { 贡献人: 'E2E帮助测试人', 贡献等级: '核心', 贡献类型: '实施', 描述: 'E2E帮助贡献' },
    });

    await page.goto('/honor');
    await page.getByText('E2E帮助测试人').first().click();
    await expect(page).toHaveURL(/\/honor\//);
    await page.waitForTimeout(1000);

    const helpBtn = await findHelpButton(page);
    if (await helpBtn.isVisible({ timeout: 5000 })) {
      await helpBtn.click();
      const modal = page.locator('.ant-modal');
      await expect(modal).toBeVisible();
      await expect(modal.getByText('个人荣誉 - 使用帮助')).toBeVisible();
      await modal.locator('.ant-modal-close').click();
    }
  });

  test('关联全景页面帮助按钮', async ({ page, request }) => {
    const res = await request.post('http://localhost:3001/api/nodes/attackTicket', {
      data: { 标题: 'E2E关联帮助测试', 状态: '处理中' },
    });
    const ticket = await res.json();

    await page.goto(`/related/attackTicket/${ticket.id}`);
    await page.waitForTimeout(1000);

    const helpBtn = await findHelpButton(page);
    if (await helpBtn.isVisible({ timeout: 5000 })) {
      await helpBtn.click();
      const modal = page.locator('.ant-modal');
      await expect(modal).toBeVisible();
      await expect(modal.getByText('关联全景 - 使用帮助')).toBeVisible();
      await modal.locator('.ant-modal-close').click();
    }
  });
});
