import { test, expect } from "@playwright/test";
import { adminLogin, injectAuth, goTo } from "./helpers";

test.describe("异地备份 — admin Modal 验证", () => {
  let auth: Awaited<ReturnType<typeof adminLogin>>;

  test.beforeAll(async ({ request }) => {
    auth = await adminLogin(request);
  });

  test.beforeEach(async ({ page }) => {
    await injectAuth(page, auth);
    await goTo(page, "/backup");
    await page.waitForSelector(".ant-card", { timeout: 10000 });
  });

  test("异地备份按钮可见", async ({ page }) => {
    await expect(page.getByRole("button", { name: /异地备份/ })).toBeVisible();
  });

  test("异地备份弹窗可打开", async ({ page }) => {
    await page.getByRole("button", { name: /异地备份/ }).click();
    await expect(page.locator(".ant-modal-title").filter({ hasText: "异地备份" })).toBeVisible();
    await expect(page.getByText("将当前数据库备份推送到远程服务器")).toBeVisible();
    await expect(page.locator('input[id="host"]')).toBeVisible();
    await expect(page.locator('input[id="user"]')).toBeVisible();
    await expect(page.locator('input[id="remoteDir"]')).toBeVisible();
    await page.locator(".ant-modal-close").click();
  });

  test("弹窗包含所有必要字段", async ({ page }) => {
    await page.getByRole("button", { name: /异地备份/ }).click();
    await expect(page.getByText("目标主机")).toBeVisible();
    await expect(page.getByText("SSH 用户")).toBeVisible();
    await expect(page.getByText("SSH 端口")).toBeVisible();
    await expect(page.getByText("远程目录")).toBeVisible();
    await expect(page.getByText("密钥路径")).toBeVisible();
    await expect(page.getByText("SSH 密码")).toBeVisible();
    await expect(page.getByText("Dry Run")).toBeVisible();
    await page.locator(".ant-modal-close").click();
  });

  test("缺少必填字段不能提交", async ({ page }) => {
    await page.getByRole("button", { name: /异地备份/ }).click();
    await page.getByRole("button", { name: /开始备份/ }).click();
    await expect(page.getByText("请输入主机地址")).toBeVisible({ timeout: 3000 });
    await page.locator(".ant-modal-close").click();
  });

  test("弹窗可关闭", async ({ page }) => {
    await page.getByRole("button", { name: /异地备份/ }).click();
    await expect(page.locator(".ant-modal-title").filter({ hasText: "异地备份" })).toBeVisible();
    await page.locator(".ant-modal-close").click();
    await expect(page.locator(".ant-modal-title").filter({ hasText: "异地备份" })).not.toBeVisible({ timeout: 3000 });
  });
});
