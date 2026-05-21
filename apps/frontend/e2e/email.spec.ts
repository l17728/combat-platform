import { test, expect } from "@playwright/test";

// FE-EM1 §45 EmailPage: route-mock 确定性。
// SMTP 配置卡载入→填写→保存 message 成功；撰写卡选人员/群组+主题/正文→发送→email-result 显示 recipients + ok。
test("FE-EM1 email config save + compose send", async ({ page }) => {
  await page.route("**/api/email/config", route => {
    if (route.request().method() === "GET")
      return route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ host: "smtp.x.com", port: 465, secure: true, username: "u", fromEmail: "a@x.com", passwordSet: false }) });
    // PUT
    return route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ host: "smtp.x.com", port: 465, secure: true, username: "u", fromEmail: "a@x.com", passwordSet: true }) });
  });
  await page.route("**/api/nodes/person**", route => {
    if (route.request().method() === "GET")
      return route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify([{ id: "p1", nodeType: "person", properties: { name: "张三", email: "zs@x.com" }, createdAt: "t", updatedAt: "t" }]) });
    return route.fallback();
  });
  await page.route("**/api/nodes/emailGroup**", route => {
    if (route.request().method() === "GET")
      return route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify([{ id: "g1", nodeType: "emailGroup", properties: { 组名: "研发组", 成员邮箱: "a@x.com,b@x.com" }, createdAt: "t", updatedAt: "t" }]) });
    return route.fallback();
  });
  let sendBody: any = null;
  await page.route("**/api/email/send", route => {
    sendBody = route.request().postDataJSON();
    return route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ recipients: ["zs@x.com", "a@x.com", "b@x.com"], ok: true, messageId: "m1" }) });
  });

  await page.goto("/email");

  // SMTP 配置卡可见，已载入 host
  const cfg = page.getByLabel("smtp-config");
  await expect(cfg).toBeVisible();
  await expect(page.locator('input[aria-label="smtp-host"]')).toHaveValue("smtp.x.com");

  // 改 host 并保存 → message 成功
  await page.locator('input[aria-label="smtp-host"]').fill("smtp.y.com");
  await page.getByRole("button", { name: "保存配置" }).click();
  await expect(page.getByText("配置已保存")).toBeVisible();

  // 撰写卡：选群组 — type-to-filter + Enter 选中高亮项，避开 popup 点击 flaky
  const groupCombo = page.getByRole("combobox", { name: "email-groups" });
  await groupCombo.click();
  await groupCombo.pressSequentially("研发组");
  await page.getByRole("option", { name: "研发组" }).first().waitFor({ state: "attached" });
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(page.locator(".ant-select-selection-item-content").filter({ hasText: "研发组" })).toBeVisible();

  // 选人员
  const personCombo = page.getByRole("combobox", { name: "email-persons" });
  await personCombo.click();
  await personCombo.pressSequentially("张三");
  await page.getByRole("option", { name: "张三" }).first().waitFor({ state: "attached" });
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(page.locator(".ant-select-selection-item-content").filter({ hasText: "张三" })).toBeVisible();

  // 主题/正文
  await page.locator('[aria-label="email-subject"]').fill("攻关进展");
  await page.locator('textarea[aria-label="email-body"]').fill("正文内容");

  // 发送
  await page.getByRole("button", { name: "发送", exact: true }).click();

  // 结果显示 recipients + ok
  const result = page.getByLabel("email-result");
  await expect(result).toBeVisible();
  await expect(result).toContainText("zs@x.com");
  await expect(result).toContainText("a@x.com");
  await expect(result).toContainText("ok");

  // 提交了群组与人员
  await expect.poll(() => sendBody?.groupNames).toEqual(["研发组"]);
  expect(sendBody?.personNames).toEqual(["张三"]);
  expect(sendBody?.subject).toBe("攻关进展");
});
