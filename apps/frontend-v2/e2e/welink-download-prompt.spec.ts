import { test, expect } from '@playwright/test';
import { API } from './helpers.js';

const DOWNLOAD_PROMPT_DISMISS_KEY = 'combat-welink-download-prompt-dismissed';

async function clearWelinkDocs(request: import('@playwright/test').APIRequestContext) {
  const res = await request.get(`${API}/api/documents`);
  if (!res.ok()) return;
  const docs = (await res.json()) as Array<{ id: string; name: string }>;
  const targets = docs.filter((d) => /welink/i.test(d.name) && /(下载|工具)/.test(d.name));
  for (const d of targets) {
    await request.delete(`${API}/api/documents/${d.id}`).catch(() => {});
  }
}

async function clearDismissFlag(page: import('@playwright/test').Page) {
  // 先进 app 同源页(任何路径都行,/login 不会跳转因为后端开了 COMBAT_NO_AUTH),
  // 再 evaluate 清 localStorage;不挂 addInitScript(否则 reload 后还会被擦)。
  await page.goto('/');
  await page.evaluate((key) => {
    try { window.localStorage.removeItem(key); } catch { /* ignore */ }
  }, DOWNLOAD_PROMPT_DISMISS_KEY);
}

test.describe('Welink 下载工具引导 Alert', () => {
  let ticketId: string;

  test.beforeEach(async ({ page }) => {
    await clearWelinkDocs(page.request);
    const res = await page.request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E Welink 下载引导', 状态: '处理中' },
    });
    const ticket = await res.json();
    ticketId = ticket.id;
    // 默认每个测试都从"未关闭"开始;但注意 addInitScript 每次导航都会跑,
    // 想测持久化的用例需要在中途取消这个钩子,因此该测试在自己内部先 reset 再 unhook。
    await clearDismissFlag(page);
  });

  test.afterEach(async ({ page }) => {
    await clearWelinkDocs(page.request);
  });

  test('未上传下载工具时,Alert 显示"管理员还未上传"+ 跳到文档中心按钮', async ({ page }) => {
    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: /Welink 消息/ }).click();

    const promptMissing = page.locator('[data-testid="welink-download-prompt-missing"]');
    await expect(promptMissing).toBeVisible({ timeout: 10000 });
    await expect(promptMissing).toContainText(/还未上传/);

    const jumpBtn = page.locator('[data-testid="welink-jump-to-documents"]');
    await expect(jumpBtn).toBeVisible();
    await jumpBtn.click();
    await expect(page).toHaveURL(/\/documents$/);
  });

  test('文档中心有匹配文档时,Alert 显示下载链接', async ({ page }) => {
    // 通过 API 上传一个名称含 Welink + 下载工具 的外链文档
    const addRes = await page.request.post(`${API}/api/documents/link`, {
      data: { name: 'Welink 消息下载工具 v1.0', url: 'https://example.com/welink-tool.exe' },
    });
    expect(addRes.ok()).toBeTruthy();
    const doc = await addRes.json();

    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: /Welink 消息/ }).click();

    const prompt = page.locator('[data-testid="welink-download-prompt"]');
    await expect(prompt).toBeVisible({ timeout: 10000 });
    await expect(prompt).toContainText(/第一步/);

    const link = page.locator('[data-testid="welink-download-link"]');
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    expect(href).toContain(`/api/documents/${doc.id}/download`);
  });

  test('点击关闭按钮后,刷新页面 Alert 不再显示(localStorage 持久化)', async ({ page }) => {
    // 准备一个匹配的文档,确保走的是「正常 Alert」分支(否则关掉的是 warning 分支也算)
    await page.request.post(`${API}/api/documents/link`, {
      data: { name: 'Welink 下载工具', url: 'https://example.com/welink-tool.exe' },
    });

    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: /Welink 消息/ }).click();

    const prompt = page.locator('[data-testid="welink-download-prompt"]');
    await expect(prompt).toBeVisible({ timeout: 10000 });

    // 点关闭(antd Alert 关闭按钮 aria-label="Close")
    await prompt.locator('.ant-alert-close-icon').click();
    await expect(prompt).toBeHidden();

    // 刷新页面;不要重置 dismiss flag(去掉 addInitScript 路径)
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: /Welink 消息/ }).click();

    // 仍不应出现 Alert
    await expect(page.locator('[data-testid="welink-download-prompt"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="welink-download-prompt-missing"]')).toHaveCount(0);
  });
});
