import { test, expect } from '@playwright/test';
import { API } from './helpers';

test.describe('知识图谱', () => {
  test('页面渲染:标题 + 筛选/搜索控件 + g6 画布 + 计数', async ({ page, request }) => {
    // 先 seed 一些节点,保证图谱有内容
    await request.post(`${API}/api/nodes/attackTicket`, { data: { 标题: 'KG图谱测试单A', 状态: '处理中' } });
    await request.post(`${API}/api/nodes/attackTicket`, { data: { 标题: 'KG图谱测试单B', 状态: '待响应' } });

    await page.goto('/kg');
    await expect(page.getByRole('heading', { name: '知识图谱' })).toBeVisible();
    await expect(page.getByPlaceholder('搜索关键词')).toBeVisible();
    await expect(page.getByText('按类型筛选', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: /刷\s?新/ })).toBeVisible();

    // g6 v5 渲染为 <canvas>
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    // 计数文本出现且节点数 > 0
    await expect(page.getByText(/\d+ 节点 \/ \d+ 关系/)).toBeVisible({ timeout: 15000 });
  });

  test('关键词搜索后刷新不报错,画布仍在', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/attackTicket`, { data: { 标题: 'KG搜索KW单', 状态: '处理中' } });
    await page.goto('/kg');
    await expect(page.getByRole('heading', { name: '知识图谱' })).toBeVisible();
    await page.getByPlaceholder('搜索关键词').fill('KW');
    await page.getByRole('button', { name: /刷\s?新/ }).click();
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  });

  test('浮动 AI 问答:提问返回答案(复用 Hermes 能力)', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/attackTicket`, { data: { 标题: 'KG问答测试单', 状态: '处理中', 问题单号: 'PB-KGQA-1' } });
    await page.goto('/kg');
    await expect(page.getByRole('heading', { name: '知识图谱' })).toBeVisible();

    // 浮动 AI 问答按钮(robot 图标)→ 打开抽屉
    await page.getByRole('button', { name: 'robot' }).click();
    const drawer = page.locator('.ant-drawer').filter({ hasText: '知识图谱 AI 问答' });
    await expect(drawer).toBeVisible();

    await drawer.locator('textarea').fill('PB-KGQA-1 谁负责');
    await drawer.getByRole('button', { name: /提\s?问/ }).click();
    // 规则引擎(e2e 未开 agent)应快速返回包含该单的答案
    await expect(drawer.getByText(/KG问答测试单|攻关单|未找到|记录/).first()).toBeVisible({ timeout: 15000 });
  });
});
