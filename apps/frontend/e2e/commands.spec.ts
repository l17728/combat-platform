import { test, expect } from "@playwright/test";

// FE-CC1 §54 自定义命令页：新建 → 运行（填参 → 执行 → 见结果）→ 删除（route-mock，确定性）
test("FE-CC1 CustomCommandsPage create + run + delete", async ({ page }) => {
  let cmds: any[] = [];
  // list (GET) + create (POST)
  await page.route("**/api/commands", route => {
    const m = route.request().method();
    if (m === "POST") {
      const body = JSON.parse(route.request().postData() || "{}");
      const cmd = { id: "c1", name: body.name, description: body.description,
        template: body.template, params: ["状态"], createdAt: "2026-05-22T00:00:00Z" };
      cmds = [cmd];
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(cmd) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(cmds) });
  });
  // run resolves to an underlying request
  await page.route("**/api/commands/c1/run", route => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ resolved: "nodes:list attackTicket --状态 进行中",
      request: { method: "GET", path: "/api/nodes/attackTicket?%E7%8A%B6%E6%80%81=%E8%BF%9B%E8%A1%8C%E4%B8%AD" } }),
  }));
  // delete
  await page.route("**/api/commands/c1", route => {
    if (route.request().method() === "DELETE") { cmds = []; return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) }); }
    return route.fallback();
  });
  // the resolved request target (runRaw)
  await page.route("**/api/nodes/attackTicket**", route => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify([{ id: "t1", nodeType: "attackTicket", properties: { 标题: "断连单", 状态: "进行中" }, createdAt: "x", updatedAt: "x" }]),
  }));

  await page.goto("/commands");
  await expect(page.getByRole("heading", { name: "自定义命令" })).toBeVisible();

  // create a command wrapping nodes:list
  await page.getByLabel("cmd-name").fill("查进行中攻关单");
  await page.getByLabel("cmd-template").fill("nodes:list attackTicket --状态 {状态}");
  await page.getByLabel("cmd-create").click();

  // appears in the table
  await expect(page.getByLabel("commands-table").getByText("查进行中攻关单")).toBeVisible();

  // run → modal prompts the 状态 param → execute → result shows the mocked node
  await page.getByLabel("run-查进行中攻关单").click();
  await page.getByLabel("arg-状态").fill("进行中");
  await page.getByLabel("cmd-execute").click();
  await expect(page.getByLabel("cmd-result")).toContainText("断连单");

  // close modal, delete
  await page.keyboard.press("Escape");
  await page.getByLabel("del-查进行中攻关单").click();
  await expect(page.getByLabel("commands-table").getByText("暂无自定义命令")).toBeVisible();
});

// FE-CC3 校验：未填名称/模板时点击保存 → 前端拦截，不发起创建请求
test("FE-CC3 create validation blocks empty submit", async ({ page }) => {
  let createCalls = 0;
  await page.route("**/api/commands", route => {
    if (route.request().method() === "POST") createCalls++;
    return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.goto("/commands");
  // 直接点保存（name/template 均空）→ 应被前端校验拦截
  await page.getByLabel("cmd-create").click();
  await expect(page.getByText("请填写命令名称")).toBeVisible();
  expect(createCalls).toBe(0);
});

// FE-CC2 首页卡片存在
test("FE-CC2 home card present", async ({ page }) => {
  await page.route("**/api/dashboard", route => route.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ tickets: { total: 0, open: 0, resolved: 0, byStatus: {} },
      contributions: { total: 0, topContributors: [] }, proposalsPending: 0,
      conflicts: { count: 0, topReasons: [] }, today: { progressEntries: 0, ticketsTouched: 0 }, recentActivity: [] }) }));
  await page.goto("/");
  await expect(page.getByLabel("home-card-/commands")).toBeVisible();
});
