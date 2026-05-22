import { test, expect } from "@playwright/test";
import type { HermesAnswer, PinnedUi } from "@combat/shared";

const ANS_WITH_UI: HermesAnswer = {
  question: "PB-999 涉及哪些单",
  intent: "ticket-by-pb",
  answer: "问题单 PB-999 下找到 1 个攻关单：\n· 《断网攻关》（状态：处理中，负责人：张三）",
  citations: [{ nodeId: "t1", nodeType: "attackTicket", summary: "断网攻关", link: "/attack/t1" }],
  uiSpec: {
    widget: "TABLE",
    params: { title: "攻关单列表", columns: ["标题", "状态", "当前处理人"],
      rows: [{ 标题: "断网攻关", 状态: "处理中", 当前处理人: "张三" }] },
    cacheKey: "ticket-by-pb:pb-999涉及哪些单",
  },
};

const PINNED: PinnedUi = {
  id: "pin-001", label: "PB-999 攻关单", question: ANS_WITH_UI.question,
  intent: "ticket-by-pb", uiSpec: ANS_WITH_UI.uiSpec!, pinnedAt: new Date().toISOString(),
};

function mockHermesRoutes(page: import("@playwright/test").Page, pins: PinnedUi[] = []) {
  page.route("**/api/hermes/ask", r => r.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify(ANS_WITH_UI),
  }));
  page.route("**/api/ui-cache/pinned**", async r => {
    if (r.request().method() === "DELETE") return r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(pins) });
  });
  page.route("**/api/ui-cache/pin", r => r.fulfill({
    status: 201, contentType: "application/json", body: JSON.stringify(PINNED),
  }));
}

// FE-HU1: Hermes 回答带 uiSpec 时显示「数据视图」折叠面板
test("FE-HU1 Hermes 回答含 uiSpec → 显示数据视图折叠面板", async ({ page }) => {
  await mockHermesRoutes(page);
  await page.goto("/hermes");

  await page.getByLabel("hermes-question").fill("PB-999 涉及哪些单");
  await page.getByRole("button", { name: "提问" }).click();

  const card = page.getByLabel("hermes-answer");
  await expect(card).toBeVisible({ timeout: 5000 });
  // 数据视图 collapse panel
  await expect(page.getByText("数据视图")).toBeVisible();
});

// FE-HU2: 固定按钮固定 UI 到侧栏
test("FE-HU2 点击固定按钮将 UI 固定到已固定侧栏", async ({ page }) => {
  await mockHermesRoutes(page);
  await page.goto("/hermes");

  await page.getByLabel("hermes-question").fill("PB-999 涉及哪些单");
  await page.getByRole("button", { name: "提问" }).click();

  const card = page.getByLabel("hermes-answer");
  await expect(card).toBeVisible({ timeout: 5000 });

  // click pin button
  await page.getByRole("button", { name: "固定" }).click();
  // pin appears in sidebar (success)
  await expect(page.getByText("PB-999 攻关单")).toBeVisible({ timeout: 3000 });
});

// FE-HU3: 侧栏有固定项时显示已固定列表
test("FE-HU3 页面加载时读取已固定 UI 并显示在侧栏", async ({ page }) => {
  await mockHermesRoutes(page, [PINNED]);
  await page.goto("/hermes");

  await expect(page.getByText("已固定")).toBeVisible({ timeout: 3000 });
  await expect(page.getByText("PB-999 攻关单")).toBeVisible();
});
