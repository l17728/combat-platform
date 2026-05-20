import { test, expect } from "@playwright/test";

test("FE-RM1 reminders queue: render + send (stub)", async ({ page }) => {
  let calledSend = false;
  await page.route("**/api/reminders**", async (route) => {
    const url = route.request().url();
    if (url.includes("/send")) { calledSend = true;
      return route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ id: "r1", kind: "问题单跟催", ticketId: "t1",
          recipientName: "甲", subject: "[跟催]", body: "停滞 5 天",
          status: "已发送", decidedBy: "运营", decidedAt: "t", createdAt: "t" }) });
    }
    if (route.request().method() === "POST" && url.endsWith("/scan")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ created: 0 }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify(calledSend ? [] : [{
        id: "r1", kind: "问题单跟催", ticketId: "t1",
        recipientName: "甲", subject: "[跟催]", body: "停滞 5 天",
        status: "待发送", createdAt: "2026-05-20T00:00:00Z",
      }]) });
  });
  await page.goto("/");
  await page.getByRole("link", { name: "跟催提醒", exact: true }).first().click();
  await expect(page).toHaveURL(/\/reminders$/);
  await expect(page.getByText("问题单跟催")).toBeVisible();
  await page.getByLabel("send-r1").click();
  await expect(page.getByRole("status")).toHaveText("暂无待发送提醒");
});

test("FE-RM2 empty queue shows status", async ({ page }) => {
  await page.route("**/api/reminders**", route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify([]),
  }));
  await page.goto("/reminders");
  await expect(page.getByRole("status")).toHaveText("暂无待发送提醒");
});
