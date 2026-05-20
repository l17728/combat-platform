// Comprehensive e2e coverage fill (user directive: 完备 Playwright coverage).
// Scope: zero-coverage, NON-schema-mutating gaps only — safe under the shared
// single-backend run (no PATCH /api/schema here; those live in coverage-schema.spec.ts).
import { test, expect } from "@playwright/test";
const API = "http://localhost:3001";

test("GAP nav: home cards + AppShell nav reach every module", async ({ page }) => {
  // GAP-1/2 home cards
  await page.goto("/");
  await page.getByRole("link", { name: /贡献录入/ }).first().click();
  await expect(page).toHaveURL(/\/contributions$/);
  await page.goto("/");
  await page.getByRole("link", { name: /导入/ }).first().click();
  await expect(page).toHaveURL(/\/import$/);
  // GAP-3c home card → 关系审批 queue
  await page.goto("/");
  await page.getByRole("link", { name: /关系审批/ }).first().click();
  await expect(page).toHaveURL(/\/proposals$/);
  await expect(page.getByRole("heading", { name: "关系审批队列" })).toBeVisible();
  // GAP-3/4/5 AppShell nav from an arbitrary page
  await page.goto("/attack");
  await page.getByRole("link", { name: "首页", exact: true }).first().click();
  await expect(page).toHaveURL(new RegExp(`/$`));
  await page.getByRole("link", { name: "贡献录入", exact: true }).first().click();
  await expect(page).toHaveURL(/\/contributions$/);
  await page.getByRole("link", { name: "导入", exact: true }).first().click();
  await expect(page).toHaveURL(/\/import$/);
  await expect(page.getByText("导入数据")).toBeVisible(); // GAP-17 IM-1 heading
});

test("GAP AttackDetail: Descriptions render, related-link, empty-progress no-op", async ({ page, request }) => {
  const t = await (await request.post(`${API}/api/nodes/attackTicket`, { data: { 标题: "覆盖详情单", 状态: "进行中" } })).json();
  await request.post(`${API}/api/nodes/${t.id}/progress`, { data: { content: "进展甲", statusSnapshot: "进行中", actor: "seed" } });
  await page.goto(`/attack/${t.id}`);
  // first(): §39 audit-section embeds CREATE/UPDATE entries whose JSON contains
  // "标题" — multi-match without first(). The Descriptions label is the natural first hit.
  await expect(page.getByText("标题").first()).toBeVisible();          // GAP-16 AD-1 Descriptions label
  await expect(page.getByText("进展甲", { exact: false }).first()).toBeVisible(); // AD-2 timeline
  // GAP-15 AD-6: empty progress-input + 追加进展 is a no-op (no #2 entry)
  await page.getByRole("button", { name: "追加进展" }).click();
  await expect(page.getByText("#2", { exact: false })).toHaveCount(0);
  // GAP-14 AD-5: 关联全景 link navigates to the ticket's relations page
  await page.getByLabel("related-link").click();
  await expect(page).toHaveURL(new RegExp(`/related/attackTicket/${t.id}`));
  await expect(page.getByText("关联全景", { exact: false })).toBeVisible();
});

test("GAP Import: failure path shows error message", async ({ page }) => {
  await page.goto("/import");
  await expect(page.getByText("导入数据")).toBeVisible();
  // GAP-18 IM-5: the error toast is ImportPage's catch on a failed POST /api/import.
  // SheetJS parses junk leniently (→ 200 {created:0}), so deterministically force
  // the HTTP failure via route interception to exercise the real error-handling path.
  await page.route("**/api/import**", route => route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"boom"}' }));
  await page.setInputFiles("input[type=file]", {
    name: "any.xlsx", mimeType: "application/octet-stream", buffer: Buffer.from("x"),
  });
  await expect(page.getByText("导入失败，请重试")).toBeVisible();
});

test("GAP PersonHonor: heading, list fields, and no-link contribution", async ({ page, request }) => {
  // contribution WITHOUT 关联攻关单 -> profile item has no 关联攻关单 link
  await request.post(`${API}/api/nodes/contribution`, {
    data: { 贡献人: "覆盖人甲", 贡献类型: "设计", 贡献等级: "关键", 贡献描述: "无关联贡献" },
  });
  await page.goto(`/honor/${encodeURIComponent("覆盖人甲")}`);
  await expect(page.getByRole("heading", { name: /个人贡献档案：覆盖人甲/ })).toBeVisible(); // GAP-22 PH-1
  await expect(page.getByText("设计", { exact: false })).toBeVisible();   // GAP-23 PH-2 类型
  await expect(page.getByText("关键", { exact: false })).toBeVisible();   // GAP-23 PH-2 等级
  await expect(page.getByText("无关联贡献", { exact: false })).toBeVisible(); // GAP-23 PH-2 描述
  await expect(page.getByRole("link", { name: "关联攻关单" })).toHaveCount(0); // GAP-24 PH-4 no link
});

test("GAP RelatedPage: direction labels, incoming edge, and empty state", async ({ page, request }) => {
  // attackTicket with ref 当前处理人 -> person (outgoing REF from ticket; incoming on person)
  const t = await (await request.post(`${API}/api/nodes/attackTicket`, { data: { 标题: "覆盖关联单", 状态: "进行中", 当前处理人: "覆盖人乙" } })).json();
  // GAP-25/RP-4: from the ticket's relations page, outgoing direction label visible
  await page.goto(`/related/attackTicket/${t.id}`);
  await expect(page.getByText("→ 本节点引用", { exact: false })).toBeVisible();
  // drill to the person -> GAP-27/RP-6 incoming edge from the ticket with the "← 引用本节点" label
  await page.getByRole("link", { name: "覆盖人乙" }).first().click();
  await expect(page).toHaveURL(/\/related\/person\//);
  await expect(page.getByText("← 引用本节点", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: /负责人/ })).toBeVisible();
  // GAP-26/RP-5: a fresh ticket with no refs/edges -> 暂无关联 status
  const lone = await (await request.post(`${API}/api/nodes/attackTicket`, { data: { 标题: "孤立单", 状态: "进行中" } })).json();
  await page.goto(`/related/attackTicket/${lone.id}`);
  await expect(page.getByRole("status")).toHaveText("暂无关联");
});
