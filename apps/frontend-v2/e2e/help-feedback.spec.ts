import { test, expect } from '@playwright/test';
import { API, waitForTable } from './helpers';

test.describe('求助反馈页 (HelpFeedback)', () => {
  test('shows error for invalid token', async ({ page }) => {
    await page.goto('/help/feedback/invalid-token-12345');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('加载失败')).toBeVisible({ timeout: 10000 });
  });

  test('shows feedback form with valid help request', async ({ page }) => {
    const personRes = await page.request.post(`${API}/api/nodes/person`, {
      headers: { 'Content-Type': 'application/json' },
      data: { 姓名: '反馈测试人' },
    });
    const person = await personRes.json();

    const ticketRes = await page.request.post(`${API}/api/nodes/attackTicket`, {
      headers: { 'Content-Type': 'application/json' },
      data: { 标题: 'E2E反馈测试攻关单', 状态: '待响应' },
    });
    const ticket = await ticketRes.json();

    const helpRes = await page.request.post(`${API}/api/help-requests`, {
      headers: { 'Content-Type': 'application/json' },
      data: {
        ticketId: ticket.id,
        requesterName: '测试求助人',
        targetEmail: 'test@example.com',
        category: '环境',
        question: '这是一个E2E测试求助问题',
      },
    });
    const helpReq = await helpRes.json();

    await page.goto(`/help/feedback/${helpReq.feedbackToken}`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: '攻关求助反馈' })).toBeVisible();
    await expect(page.getByText('E2E反馈测试攻关单')).toBeVisible();
    await expect(page.getByText('测试求助人')).toBeVisible();
    await expect(page.getByText('这是一个E2E测试求助问题')).toBeVisible();
    await expect(page.getByPlaceholder('请填写您的回复...')).toBeVisible();
    await expect(page.getByRole('button', { name: '提交反馈' })).toBeVisible();
  });

  test('submit feedback successfully', async ({ page }) => {
    const ticketRes = await page.request.post(`${API}/api/nodes/attackTicket`, {
      headers: { 'Content-Type': 'application/json' },
      data: { 标题: 'E2E提交反馈测试', 状态: '待响应' },
    });
    const ticket = await ticketRes.json();

    const helpRes = await page.request.post(`${API}/api/help-requests`, {
      headers: { 'Content-Type': 'application/json' },
      data: {
        ticketId: ticket.id,
        requesterName: '提交测试人',
        targetEmail: 'test2@example.com',
        category: '领域专家',
        question: '需要专家支持',
      },
    });
    const helpReq = await helpRes.json();

    await page.goto(`/help/feedback/${helpReq.feedbackToken}`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByPlaceholder('请填写您的回复...')).toBeVisible();
    await page.getByPlaceholder('请填写您的回复...').fill('E2E测试反馈内容，已解决');
    await page.getByRole('button', { name: '提交反馈' }).click();

    await expect(page.getByText('反馈已提交，感谢您的帮助！')).toBeVisible({ timeout: 10000 });
  });

  test('feedback form requires content', async ({ page }) => {
    const ticketRes = await page.request.post(`${API}/api/nodes/attackTicket`, {
      headers: { 'Content-Type': 'application/json' },
      data: { 标题: 'E2E表单验证测试', 状态: '待响应' },
    });
    const ticket = await ticketRes.json();

    const helpRes = await page.request.post(`${API}/api/help-requests`, {
      headers: { 'Content-Type': 'application/json' },
      data: {
        ticketId: ticket.id,
        requesterName: '验证测试人',
        targetEmail: 'test3@example.com',
        category: '资源',
        question: '需要资源支持',
      },
    });
    const helpReq = await helpRes.json();

    await page.goto(`/help/feedback/${helpReq.feedbackToken}`);
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: '提交反馈' }).click();
    await expect(page.getByText('请输入反馈内容')).toBeVisible();
  });

  test('shows loading spinner initially', async ({ page }) => {
    const ticketRes = await page.request.post(`${API}/api/nodes/attackTicket`, {
      headers: { 'Content-Type': 'application/json' },
      data: { 标题: 'E2E加载测试', 状态: '待响应' },
    });
    const ticket = await ticketRes.json();

    const helpRes = await page.request.post(`${API}/api/help-requests`, {
      headers: { 'Content-Type': 'application/json' },
      data: {
        ticketId: ticket.id,
        requesterName: '加载测试人',
        targetEmail: 'test4@example.com',
        category: '团队协作',
        question: '协作问题',
      },
    });
    const helpReq = await helpRes.json();

    const responsePromise = page.waitForResponse(resp => resp.url().includes(`/api/help/feedback/${helpReq.feedbackToken}`));
    page.goto(`/help/feedback/${helpReq.feedbackToken}`);
    await responsePromise;
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: '攻关求助反馈' })).toBeVisible();
  });

  test('feedback with optional name field', async ({ page }) => {
    const ticketRes = await page.request.post(`${API}/api/nodes/attackTicket`, {
      headers: { 'Content-Type': 'application/json' },
      data: { 标题: 'E2E带姓名反馈', 状态: '待响应' },
    });
    const ticket = await ticketRes.json();

    const helpRes = await page.request.post(`${API}/api/help-requests`, {
      headers: { 'Content-Type': 'application/json' },
      data: {
        ticketId: ticket.id,
        requesterName: '带姓名测试人',
        targetEmail: 'test5@example.com',
        category: '环境',
        question: '环境问题',
      },
    });
    const helpReq = await helpRes.json();

    await page.goto(`/help/feedback/${helpReq.feedbackToken}`);
    await page.waitForLoadState('networkidle');

    await page.getByPlaceholder('请填写您的回复...').fill('附带姓名的反馈');
    await page.getByPlaceholder('姓名').fill('反馈者张三');
    await page.getByRole('button', { name: '提交反馈' }).click();

    await expect(page.getByText('反馈已提交，感谢您的帮助！')).toBeVisible({ timeout: 10000 });
  });

  test('page has no sidebar (public page)', async ({ page }) => {
    const ticketRes = await page.request.post(`${API}/api/nodes/attackTicket`, {
      headers: { 'Content-Type': 'application/json' },
      data: { 标题: 'E2E公共页面测试', 状态: '待响应' },
    });
    const ticket = await ticketRes.json();

    const helpRes = await page.request.post(`${API}/api/help-requests`, {
      headers: { 'Content-Type': 'application/json' },
      data: {
        ticketId: ticket.id,
        requesterName: '公共页面测试人',
        targetEmail: 'test6@example.com',
        category: '环境',
        question: '公共页面问题',
      },
    });
    const helpReq = await helpRes.json();

    await page.goto(`/help/feedback/${helpReq.feedbackToken}`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.ant-layout-sider')).not.toBeVisible();
  });

  test('help button is visible on feedback page', async ({ page }) => {
    const ticketRes = await page.request.post(`${API}/api/nodes/attackTicket`, {
      headers: { 'Content-Type': 'application/json' },
      data: { 标题: 'E2E帮助按钮测试', 状态: '待响应' },
    });
    const ticket = await ticketRes.json();

    const helpRes = await page.request.post(`${API}/api/help-requests`, {
      headers: { 'Content-Type': 'application/json' },
      data: {
        ticketId: ticket.id,
        requesterName: '帮助按钮测试人',
        targetEmail: 'test7@example.com',
        category: '环境',
        question: '帮助按钮问题',
      },
    });
    const helpReq = await helpRes.json();

    await page.goto(`/help/feedback/${helpReq.feedbackToken}`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.anticon-question-circle').first()).toBeVisible();
  });
});
