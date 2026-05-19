import { test, expect } from "@playwright/test";
const API = "http://localhost:3001";

test("FE-P1 proposals queue: nav, scan, approve; RelatedPage candidate group", async ({ page, request }) => {
  await request.post(`${API}/api/nodes/attackTicket`, { data: { 标题: "P1单", 状态: "进行中", 当前处理人: "孙悟空" } });
  await request.post(`${API}/api/nodes/attackTicket`, { data: { 标题: "P2单", 状态: "进行中", 当前处理人: "孙悟饭" } });

  await page.goto("/");
  await page.getByRole("link", { name: "关系审批", exact: true }).first().click();
  await expect(page).toHaveURL(/\/proposals$/);
  await page.getByLabel("scan-proposals").click();
  // non-vacuous: a real candidate row + its SAME_AS relationType must appear
  const approve = page.getByLabel(/^approve-/).first();
  await expect(approve).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "SAME_AS" }).first()).toBeVisible();
  const approveId = await approve.getAttribute("aria-label"); // approve-<proposalId>

  const persons = await (await page.request.get(`${API}/api/nodes/person`)).json();
  await page.goto(`/related/person/${persons[0].id}`);
  await expect(page.getByRole("heading", { name: "候选关系（待审批）" })).toBeVisible();

  await page.goto("/proposals");
  await page.getByLabel(approveId!).click();
  // the approved proposal specifically must leave the 待审批 queue
  await expect(page.getByLabel(approveId!)).toHaveCount(0);
});

test("FE-P2 ref cell jumps directly to the referenced person's relations page", async ({ page, request }) => {
  await request.post(`${API}/api/nodes/attackTicket`, { data: { 标题: "直跳单", 状态: "进行中", 当前处理人: "唐僧" } });
  await page.goto("/attack");
  await page.getByRole("cell", { name: "唐僧" }).getByRole("link").click();
  await expect(page).toHaveURL(/\/related\/person\//);
  await expect(page.getByText("关联全景", { exact: false })).toBeVisible();
});
