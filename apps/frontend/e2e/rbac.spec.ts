import { test, expect } from "@playwright/test";

// FE-RB1 §50 角色切换 + 普通角色录贡献含等级 → 403 提示
test("FE-RB1 role select present; normal role setting 贡献等级 shows 403 hint", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("combobox", { name: "role-select" })).toBeVisible();

  // contribution: GET list → []; POST → 403 when normal role sets 贡献等级
  await page.route("**/api/nodes/contribution**", route => {
    if (route.request().method() === "GET")
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    const role = route.request().headers()["x-role"];
    const body = route.request().postDataJSON?.() ?? {};
    if (role === "normal" && body["贡献等级"])
      return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "仅 Leader 可标定贡献等级" }) });
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "c1", nodeType: "contribution", properties: body, createdAt: "t", updatedAt: "t" }) });
  });
  // schema for contribution (so EntityTable renders draft inputs incl 贡献等级)
  await page.route("**/api/schema/contribution", route => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ nodeType: "contribution", label: "贡献记录", identityKeys: [], derivedToKG: true,
      fields: [
        { id: "贡献人", name: "贡献人", type: "string", label: "贡献人", required: true },
        { id: "贡献等级", name: "贡献等级", type: "string", label: "贡献等级" },
      ] }) }));
  await page.goto("/contributions");
  await page.getByRole("button", { name: "new-row" }).click();
  await page.getByLabel("draft-贡献人").fill("甲");
  await page.getByLabel("draft-贡献等级").fill("核心");
  await page.getByRole("button", { name: "create-row" }).click();
  // antd message error with the 403 detail
  await expect(page.getByText(/仅 Leader 可标定贡献等级/).first()).toBeVisible();
});
