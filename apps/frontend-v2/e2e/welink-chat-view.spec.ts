import { test, expect } from '@playwright/test';
import { API } from './helpers.js';

// 真实样本 — 一条 TEXT_MSG / 一条 CARD_MSG / 一条 PICTURE_MSG
const RAW_SAMPLES = {
  messages: [
    {
      msgId: 'chat-text-1',
      contentType: 'TEXT_MSG',
      sender: 'l00865342',
      serverSendTime: 1779691346372,
      content: '陈挺,本周末之前能刷新完不',
    },
    {
      msgId: 'chat-card-1',
      contentType: 'CARD_MSG',
      sender: 'p30007122',
      serverSendTime: 1779958274135,
      content: {
        cardType: 65,
        cardContext: {
          preMsg: {
            messageID: 'pre-abc',
            nameZH: '陈挺',
            sender: 'c00493147',
            type: 0,
            content: '@蒲星武 黄色底纹的,先上',
          },
          replyMsg: {
            type: 0,
            content: '@所有人 已刷新,https://playwright.dev/test-link',
          },
        },
      },
    },
    {
      msgId: 'chat-pic-1',
      contentType: 'PICTURE_MSG',
      sender: 'c00493147',
      serverSendTime: 1780131329333,
      content: '[图片]',
      images: [
        {
          filename: '3231A24F.png',
          // 用占位透明 PNG dataURL 避免外网依赖
          url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
          width: 1745,
          height: 615,
          size: 190839,
          md5: '8bcde10f3618fcd3fcf26235bd141141',
        },
      ],
    },
  ],
};

test.describe('Welink 聊天视图', () => {
  let ticketId: string;

  test.beforeEach(async ({ page }) => {
    // 默认列表视图,确保不污染上一个 case 的偏好
    await page.addInitScript(() => {
      try { window.localStorage.removeItem('combat-welink-view'); } catch {}
    });
    const res = await page.request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: 'E2E Welink 聊天视图', 状态: '处理中' },
    });
    const ticket = await res.json();
    ticketId = ticket.id;

    const up = await page.request.post(`${API}/api/tickets/${ticketId}/welink-messages`, {
      data: RAW_SAMPLES,
    });
    expect(up.ok()).toBeTruthy();
  });

  test('切换到聊天视图,TEXT/CARD/PICTURE 三类气泡均可见', async ({ page }) => {
    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: /Welink 消息/ }).click();

    await expect(page.getByText(/共 3 条/).first()).toBeVisible();

    // 切到聊天视图
    await page.locator('.ant-segmented-item').filter({ hasText: '聊天视图' }).click();
    const chat = page.getByTestId('welink-chat-view');
    await expect(chat).toBeVisible();

    // 三种气泡都在
    const bubbles = chat.getByTestId('welink-bubble');
    await expect(bubbles).toHaveCount(3);

    const textBubble = chat.locator('[data-content-type="TEXT_MSG"]');
    await expect(textBubble).toContainText('陈挺,本周末之前能刷新完不');

    const cardBubble = chat.locator('[data-content-type="CARD_MSG"]');
    await expect(cardBubble).toContainText('引用 陈挺');
    await expect(cardBubble).toContainText('@蒲星武 黄色底纹的,先上');
    await expect(cardBubble).toContainText('已刷新');

    const picBubble = chat.locator('[data-content-type="PICTURE_MSG"]');
    await expect(picBubble).toContainText('[图片]');
    await expect(picBubble.getByTestId('welink-picture')).toHaveCount(1);
  });

  test('姓名查不到 → 显示原工号(不伪造姓名)', async ({ page }) => {
    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: /Welink 消息/ }).click();
    await page.locator('.ant-segmented-item').filter({ hasText: '聊天视图' }).click();

    const senderLines = page.getByTestId('welink-sender-line');
    await expect(senderLines.first()).toBeVisible();
    // 三个 sender 都是 person 表里没有的工号,应当原样显示
    await expect(senderLines.filter({ hasText: 'l00865342' })).toHaveCount(1);
    await expect(senderLines.filter({ hasText: 'p30007122' })).toHaveCount(1);
    await expect(senderLines.filter({ hasText: 'c00493147' })).toHaveCount(1);
    // 不应出现"未知"或"匿名"
    const all = await senderLines.allTextContents();
    for (const t of all) {
      expect(t).not.toContain('未知');
      expect(t).not.toContain('匿名');
    }
  });

  test('卡片消息中的链接渲染为 <a target=_blank>', async ({ page }) => {
    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: /Welink 消息/ }).click();
    await page.locator('.ant-segmented-item').filter({ hasText: '聊天视图' }).click();

    const link = page.locator('[data-content-type="CARD_MSG"] a[href*="playwright.dev"]');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('target', '_blank');
  });

  test('视图切换偏好记忆到 localStorage', async ({ page }) => {
    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: /Welink 消息/ }).click();
    await page.locator('.ant-segmented-item').filter({ hasText: '聊天视图' }).click();
    await expect(page.getByTestId('welink-chat-view')).toBeVisible();

    const stored = await page.evaluate(() => window.localStorage.getItem('combat-welink-view'));
    expect(stored).toBe('chat');

    // 切回列表
    await page.locator('.ant-segmented-item').filter({ hasText: '列表视图' }).click();
    await expect(page.locator('.ant-table')).toBeVisible();
    const stored2 = await page.evaluate(() => window.localStorage.getItem('combat-welink-view'));
    expect(stored2).toBe('list');
  });

  test('日期分隔条按天显示', async ({ page }) => {
    await page.goto(`/attack/${ticketId}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: /Welink 消息/ }).click();
    await page.locator('.ant-segmented-item').filter({ hasText: '聊天视图' }).click();

    const dividers = page.getByTestId('welink-date-divider');
    // 三条样本横跨多天,至少 1 个分隔条
    await expect(dividers.first()).toBeVisible();
    const count = await dividers.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });
});
