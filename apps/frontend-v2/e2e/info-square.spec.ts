import { test, expect } from '@playwright/test';
import { API, selectOption } from './helpers';

test.describe('信息广场', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: /信息广场/ }).click();
    await expect(page.getByRole('heading', { name: '信息广场' })).toBeVisible();
  });

  test('renders empty state and publish button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /发布信息/ })).toBeVisible();
    await expect(page.getByText('暂无信息')).toBeVisible();
  });

  test('creates an info card via drawer', async ({ page }) => {
    await page.getByRole('button', { name: /发布信息/ }).click();
    await expect(page.locator('.ant-drawer').filter({ hasText: '发布信息' })).toBeVisible();

    await page.locator('.ant-drawer').filter({ hasText: '发布信息' }).getByPlaceholder('请输入信息标题').fill('E2E测试通知');

    const drawer = page.locator('.ant-drawer').filter({ hasText: '发布信息' });
    const importanceSelect = drawer.locator('.ant-select').nth(0);
    await selectOption(page, importanceSelect, '重要');

    const categorySelect = drawer.locator('.ant-select').nth(1);
    await selectOption(page, categorySelect, '通知');

    await drawer.getByPlaceholder(/支持 Markdown/).fill('## 测试内容\n\n这是一个**加粗**测试。');

    await drawer.getByRole('button', { name: /^发\s?布$/ }).click();
    await expect(page.getByText('发布成功')).toBeVisible();

    await expect(page.getByText('E2E测试通知')).toBeVisible();
    await expect(page.getByText('重要').first()).toBeVisible();
    await expect(page.getByText('通知').first()).toBeVisible();
  });

  test('click card opens detail drawer', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/infoCard`, {
      data: { 标题: 'E2E详情测试', 重要程度: '一般', 信息分类: '公告', 内容: '## 公告内容\n\n测试详情。', 发布人: 'admin' },
    });

    await page.reload();
    await page.getByRole('tab', { name: /信息广场/ }).click();

    await page.getByText('E2E详情测试').click();
    await expect(page.locator('.ant-drawer').filter({ hasText: 'E2E详情测试' })).toBeVisible();
    await expect(page.locator('.markdown-body').getByRole('heading', { name: '公告内容' })).toBeVisible();
  });

  test('filter by category', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/infoCard`, {
      data: { 标题: '分类A通知', 重要程度: '普通', 信息分类: '通知', 发布人: 'admin' },
    });
    await request.post(`${API}/api/nodes/infoCard`, {
      data: { 标题: '分类B公告', 重要程度: '普通', 信息分类: '公告', 发布人: 'admin' },
    });

    await page.reload();
    await page.getByRole('tab', { name: /信息广场/ }).click();

    const categorySelect = page.locator('.ant-select').nth(0);
    await selectOption(page, categorySelect, '通知');

    await expect(page.getByText('分类A通知')).toBeVisible();
    await expect(page.getByText('分类B公告')).not.toBeVisible();
  });

  test('search by title', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/infoCard`, {
      data: { 标题: '搜索目标卡片', 重要程度: '普通', 信息分类: '其他', 发布人: 'admin' },
    });
    await request.post(`${API}/api/nodes/infoCard`, {
      data: { 标题: '不应出现的卡片', 重要程度: '普通', 信息分类: '其他', 发布人: 'admin' },
    });

    await page.reload();
    await page.getByRole('tab', { name: /信息广场/ }).click();

    await page.getByPlaceholder('搜索标题/内容').fill('搜索目标');
    await expect(page.getByText('搜索目标卡片')).toBeVisible();
    await expect(page.getByText('不应出现的卡片')).not.toBeVisible();
  });

  test('admin can delete card from detail drawer', async ({ page, request }) => {
    const res = await request.post(`${API}/api/nodes/infoCard`, {
      data: { 标题: '待删除卡片', 重要程度: '普通', 信息分类: '其他', 发布人: 'admin' },
    });
    const card = await res.json();

    await page.reload();
    await page.getByRole('tab', { name: /信息广场/ }).click();

    await page.getByText('待删除卡片').click();
    await expect(page.locator('.ant-drawer').filter({ hasText: '待删除卡片' })).toBeVisible();

    await page.getByRole('button', { name: /删\s?除/ }).click();
    await page.locator('.ant-popconfirm').getByRole('button', { name: /^确\s?定$/ }).click();

    await expect(page.getByText('删除成功')).toBeVisible();
    await expect(page.getByText('待删除卡片')).not.toBeVisible();
  });

  test('drawer close does not create card', async ({ page }) => {
    await page.getByRole('button', { name: /发布信息/ }).click();
    const drawer = page.locator('.ant-drawer').filter({ hasText: '发布信息' });
    await drawer.getByPlaceholder('请输入信息标题').fill('不应存在的卡片');

    await drawer.locator('.ant-drawer-close').click();

    await expect(page.getByText('不应存在的卡片')).not.toBeVisible();
  });

  test('renders markdown content in detail', async ({ page, request }) => {
    await request.post(`${API}/api/nodes/infoCard`, {
      data: {
        标题: 'Markdown渲染测试',
        重要程度: '一般',
        信息分类: '经验',
        内容: '## 标题\n\n- 列表项1\n- 列表项2\n\n**加粗文本**',
        发布人: 'admin',
      },
    });

    await page.reload();
    await page.getByRole('tab', { name: /信息广场/ }).click();

    await page.getByText('Markdown渲染测试').click();
    const drawer = page.locator('.ant-drawer').filter({ hasText: 'Markdown渲染测试' });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('加粗文本')).toBeVisible();
    await expect(drawer.getByText('列表项1')).toBeVisible();
  });
});
