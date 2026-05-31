import { test, expect } from "@playwright/test";
import { API } from "./helpers";
import dayjs from "dayjs";

// v2.7: 日历视图
test.describe("攻关作战台 — 日历视图 (Calendar)", () => {
  test("Segmented 切到日历,展示当月色块", async ({ page, request }) => {
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: "E2E日历单A", 状态: "处理中", 事件级别: "P1" },
    });
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: "E2E日历单B", 状态: "处理中", 事件级别: "P3" },
    });

    await page.goto("/attack");
    await page.locator(".ant-table").first().waitFor({ state: "visible", timeout: 10000 });
    const switcher = page.getByTestId("view-switcher");
    await switcher.getByText("日历").click();

    await expect(page.getByTestId("attack-calendar")).toBeVisible();
    // 当天的单元格应该可见,显示 "N 条"
    const today = dayjs().format("YYYY-MM-DD");
    const cell = page.getByTestId(`cal-cell-${today}`);
    await expect(cell).toBeVisible();
    await expect(cell.getByText(/条/)).toBeVisible();

    // URL 同步
    await expect(page).toHaveURL(/view=calendar/);
  });

  test("点单元格弹小卡列出当日攻关单", async ({ page, request }) => {
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: "E2E日历点击单", 状态: "处理中", 事件级别: "P2" },
    });

    await page.goto("/attack?view=calendar");
    await expect(page.getByTestId("attack-calendar")).toBeVisible();

    const today = dayjs().format("YYYY-MM-DD");
    const cell = page.getByTestId(`cal-cell-${today}`);
    await cell.click();

    // Popover 内容渲染
    const pop = page.getByTestId(`cal-pop-${today}`);
    await expect(pop).toBeVisible({ timeout: 5000 });
    await expect(pop.getByText("E2E日历点击单")).toBeVisible();
  });

  test("按创建时间/更新时间切换 Switch", async ({ page, request }) => {
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: "E2E日历切换轴", 状态: "处理中" },
    });
    await page.goto("/attack?view=calendar");
    const sw = page.getByTestId("cal-by-updated");
    await expect(sw).toBeVisible();
    // 默认未选中(按创建时间),点一下切到按更新时间
    await sw.click();
    // 仍然能看到日历(切轴不应该崩溃)
    await expect(page.getByTestId("attack-calendar")).toBeVisible();
  });

  test("月切换 — antd Calendar 顶部按钮存在", async ({ page, request }) => {
    await request.post(`${API}/api/nodes/attackTicket`, {
      data: { 标题: "E2E月切换", 状态: "处理中" },
    });
    await page.goto("/attack?view=calendar");
    await expect(page.getByTestId("attack-calendar")).toBeVisible();
    // antd Calendar header 月份选择存在
    const header = page.locator(".ant-picker-calendar-header");
    await expect(header).toBeVisible();
  });
});
