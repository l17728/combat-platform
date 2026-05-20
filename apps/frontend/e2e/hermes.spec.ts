import { test, expect } from "@playwright/test";

// FE-HM1 §35 Hermes 问答 MVP: TextArea + 提问 + 答案卡 + 引用链接（路由 mock，确定性）
test("FE-HM1 HermesPage ask shows answer card + citations", async ({ page }) => {
  await page.route("**/api/hermes/ask", route => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({
      question: "断网攻关 谁负责？",
      intent: "owner",
      answer: "按标题匹配到 1 个攻关单：\n· 《断网攻关》当前处理人：甲（状态：进行中）",
      citations: [
        { nodeId: "t1", nodeType: "attackTicket", summary: "断网攻关", link: "/attack/t1" },
      ],
    }),
  }));

  await page.goto("/hermes");
  await expect(page.getByRole("heading", { name: /Hermes 问答/ })).toBeVisible();
  const ta = page.getByLabel("hermes-question");
  await ta.fill("断网攻关 谁负责？");
  await page.getByRole("button", { name: "提问" }).click();

  const card = page.getByLabel("hermes-answer");
  await expect(card).toBeVisible();
  await expect(card).toContainText("当前处理人：甲");
  await expect(card.getByText(/负责人/)).toBeVisible(); // intent tag

  const cit = page.getByLabel("hermes-citations");
  await expect(cit).toBeVisible();
  await expect(cit.getByRole("link", { name: "断网攻关" })).toBeVisible();
});
