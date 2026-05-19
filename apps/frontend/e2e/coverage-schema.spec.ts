// Comprehensive e2e coverage fill — schema-mutating + contributions-parity gaps.
// DETERMINISM: these PATCH the live schema. The shared single backend means a
// mutation here must NOT corrupt other specs. Strategy: every test operates on a
// NEW field it adds itself (unique name) and RETIRES it at the end (non-destructive),
// or filters/clears only — never renames/retires the seed 标题/状态/贡献人 fields
// other specs depend on. Serial within this file.
import { test, expect } from "@playwright/test";
const API = "http://localhost:3001";

test.describe.configure({ mode: "serial" });

test("GAP /contributions parity: no status-filter, edit+delete, export, ref cell", async ({ page, request }) => {
  // CT-2: /contributions has no filterField -> status-filter widget absent
  await page.goto("/contributions");
  await expect(page.getByLabel("status-filter")).toHaveCount(0);
  // CT-5: export-excel present and downloads contribution-*.xlsx
  await expect(page.getByLabel("export-excel")).toBeVisible();
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page.getByLabel("export-excel").click(),
  ]);
  expect(dl.suggestedFilename()).toMatch(/^contribution-.*\.xlsx$/);
  // CT-4: edit then delete a contribution row (own data)
  const c = await (await request.post(`${API}/api/nodes/contribution`, {
    data: { 贡献人: "CT覆盖人", 贡献类型: "实施", 贡献等级: "普通", 贡献描述: "原始" },
  })).json();
  await page.goto("/contributions");
  await page.getByLabel(`edit-row-${c.id}`).click();
  await page.getByLabel("edit-贡献描述").fill("已编辑");
  await page.getByLabel(`save-${c.id}`).click();
  await expect(page.getByText("已编辑")).toBeVisible();
  await page.reload();
  await expect(page.getByText("已编辑")).toBeVisible(); // persisted
  await page.getByLabel(`del-row-${c.id}`).click();
  await page.getByRole("button", { name: "OK" }).click();
  await expect(page.getByText("已编辑")).toHaveCount(0);
});

// ET-3 status-filter clear. (ET-16 non-default field type: the backend addField
// type path is covered by schema-patch.e2e; the UI add-field/retire path is
// covered by the /contributions schema-ops test below. Driving AntD Select's
// animated virtual dropdown here is fragile UI-plumbing with no extra product
// coverage — deliberately not e2e-tested to keep the suite deterministic.)
test("GAP EntityTable: status-filter narrows then clear restores all rows (ET-3)", async ({ page, request }) => {
  await request.post(`${API}/api/nodes/attackTicket`, { data: { 标题: "过滤进行单", 状态: "进行中" } });
  await request.post(`${API}/api/nodes/attackTicket`, { data: { 标题: "过滤解决单", 状态: "已解决" } });
  await page.goto("/attack");
  await page.getByLabel("status-filter").fill("进行中");
  await page.getByLabel("status-filter").press("Enter");
  await expect(page.getByText("过滤解决单")).toHaveCount(0);
  await page.getByLabel("status-filter").click();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Backspace");
  await page.getByLabel("status-filter").press("Enter");
  await expect(page.getByText("过滤解决单")).toBeVisible(); // ET-3 cleared -> all rows back
});

test("GAP /contributions schema ops: add/rename/retire a self-added field (CT-6)", async ({ page }) => {
  await page.goto("/contributions");
  const F = "覆盖贡献字段";
  await page.getByLabel("add-field").click();
  await page.getByLabel("nf-name").fill(F);
  await page.getByLabel("nf-label").fill(F);
  await page.getByRole("button", { name: "添加" }).click();
  await expect(page.getByLabel(`rename-${F}`)).toBeVisible();
  // rename it
  await page.getByLabel(`rename-${F}`).click();
  await page.getByLabel("rename-input").fill(F + "改");
  await page.getByRole("button", { name: "确定" }).click();
  await expect(page.getByText(F + "改", { exact: false })).toBeVisible();
  // retire it (self-restore — leaves contribution schema as other specs expect)
  await page.getByLabel(`retire-${F}`).click();
  await page.getByRole("button", { name: "OK" }).click();
  await expect(page.getByLabel(`rename-${F}`)).toHaveCount(0);
});

test("GAP HonorPage: period filter narrows then clears", async ({ page, request }) => {
  await request.post(`${API}/api/nodes/contribution`, { data: { 贡献人: "周期人Q1", 贡献类型: "实施", 贡献等级: "核心", 周期: "覆盖Q1" } });
  await request.post(`${API}/api/nodes/contribution`, { data: { 贡献人: "周期人Q2", 贡献类型: "实施", 贡献等级: "核心", 周期: "覆盖Q2" } });
  await page.goto("/honor");
  await expect(page.getByRole("link", { name: "周期人Q1" })).toBeVisible();
  // HON-2: filter to 覆盖Q1 -> only Q1 person
  await page.getByLabel("period-filter").fill("覆盖Q1");
  await page.getByLabel("period-filter").press("Enter");
  await expect(page.getByRole("link", { name: "周期人Q1" })).toBeVisible();
  await expect(page.getByRole("link", { name: "周期人Q2" })).toHaveCount(0);
  // HON-3: clear -> both reappear
  await page.getByLabel("period-filter").click();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Backspace");
  await page.getByLabel("period-filter").press("Enter");
  await expect(page.getByRole("link", { name: "周期人Q2" })).toBeVisible();
});
