import { test, expect } from "@playwright/test";
const API = "http://localhost:3001";

// FE-DM1 列表页可访问 + schema 已被后端加载（领域名列头可见）
test("FE-DM1 /domains 列表页可访问，schema 字段可见", async ({ page }) => {
  await page.goto("/domains");
  await expect(page.getByRole("heading", { name: "领域台" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /领域（可编辑）/ })).toBeVisible();
  // schema fields must be loaded as columns
  await expect(page.getByText("领域名", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("领域负责人", { exact: false }).first()).toBeVisible();
});

// FE-DM2 通过 API 创建一条 domain，列表中可见，且 /related/domain/:id 可访问
test("FE-DM2 创建 domain 数据可见 + 关联全景可达", async ({ page, request }) => {
  const name = "ModelArts-DM-" + Date.now();
  const created = await (await request.post(`${API}/api/nodes/domain`, {
    data: { name, owner: "DM负责人", services: "MA-Train,MA-Infer", description: "训练与推理子域", tags: "p0,核心" },
  })).json();
  expect(created.id).toBeTruthy();

  await page.goto("/domains");
  await expect(page.getByRole("link", { name })).toBeVisible();
  await expect(page.getByText("训练与推理子域")).toBeVisible();

  // navigate to relation panorama for this domain
  await page.getByRole("link", { name }).first().click();
  await expect(page).toHaveURL(new RegExp(`/related/domain/${created.id}`));
});

// FE-DM3 主页卡片可点跳转到 /domains
test("FE-DM3 主页卡片可点跳转到 /domains", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("home-card-/domains")).toBeVisible();
  await page.getByLabel("home-card-/domains").click();
  await expect(page).toHaveURL(/\/domains$/);
  await expect(page.getByRole("heading", { name: "领域台" })).toBeVisible();
});

// FE-DM4 在 /domains 页面通过 UI 新增一条 domain
test("FE-DM4 UI 新增一条 domain 并在列表可见", async ({ page }) => {
  const name = "UI-DM-" + Date.now();
  await page.goto("/domains");
  await page.getByLabel("new-row").click();
  await page.getByLabel("draft-name").fill(name);
  await page.getByLabel("draft-services").fill("svc-x,svc-y");
  await page.getByLabel("draft-description").fill("UI 创建的领域");
  await page.getByLabel("create-row").click();
  await expect(page.getByText(name)).toBeVisible();
  await expect(page.getByText("UI 创建的领域")).toBeVisible();
});
