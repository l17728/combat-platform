import { test, expect } from "@playwright/test";

test("FE-DR1 daily-report: nav, mocked render, copy-to-clipboard", async ({ page }) => {
  await page.route("**/api/daily-report**", route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({
      date: "2026-05-20",
      sections: [{ ticketId: "t1", 标题: "日报演示单DR", latestStatus: "进行中",
        entries: [{ seqNo: 1, statusSnapshot: "进行中", content: "进展甲DR", updatedBy: "用户DR", at: "2026-05-20T01:00:00Z" }],
      }],
      summary: { ticketsTouched: 1, entriesTotal: 1, openByStatus: { 进行中: 5 } },
    }),
  }));
  // Robust stub: defineProperty (plain assignment is a no-op on the non-writable
  // navigator.clipboard property in Chromium). Record the copied text on window
  // so the test can assert deterministically, independent of AntD toast lifetime.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async (t: string) => { (window as unknown as { __copied?: string }).__copied = t; } },
      configurable: true,
    });
  });
  await page.goto("/");
  await page.getByRole("link", { name: "攻关日报", exact: true }).first().click();
  await expect(page).toHaveURL(/\/daily-report$/);
  await expect(page.getByText("日报演示单DR")).toBeVisible();
  await expect(page.getByText("进展甲DR", { exact: false })).toBeVisible();
  await page.getByLabel("copy-report").click();
  await expect.poll(async () => await page.evaluate(() =>
    (window as unknown as { __copied?: string }).__copied ?? "")).toContain("日报演示单DR");
});

test("FE-DR2 daily-report: empty day shows role=status", async ({ page }) => {
  await page.route("**/api/daily-report**", route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({
      date: "2000-01-01", sections: [],
      summary: { ticketsTouched: 0, entriesTotal: 0, openByStatus: {} },
    }),
  }));
  await page.goto("/daily-report");
  await expect(page.getByRole("status")).toHaveText("该日无进展记录");
});
