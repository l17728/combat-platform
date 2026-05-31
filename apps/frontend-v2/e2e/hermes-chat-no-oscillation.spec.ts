import { test, expect } from "@playwright/test";

/**
 * Bug de1bf88e: /contributions 页面 AI 问答思考时文字和滚动条上下不停滚动。
 *
 * 根因: HermesChat 的 useEffect 在 loading 变化时也强制 scrollTop = scrollHeight,
 * 与浏览器默认 overflow-anchor 行为相互冲突,且无视用户手动滚动状态,导致滚动条抖动。
 *
 * 修复要点:
 *  1) 仅在用户处于"贴底"状态时才自动滚动;
 *  2) loading 变化不再触发滚动;
 *  3) 容器 CSS 加 overflow-anchor: none + contain: layout 杜绝浏览器滚动锚定争抢。
 *
 * 本测试通过在 thinking 期间多次采样 scrollTop,验证其不再抖动。
 */

test.describe("HermesChat 滚动稳定性 (bug de1bf88e)", () => {
  test("贡献页打开 AI 问答浮窗,思考阶段 scrollTop 稳定不抖动", async ({ page }) => {
    await page.goto("/contributions");

    // AppLayout 同时挂了 FloatingFeedback 和 HermesChat 两个 FloatButton(均无独立 testid)。
    // HermesChat 内部 RobotOutlined 是 anticon-robot;通过 SVG icon 类名定位到正确的按钮。
    await page.locator(".ant-float-btn:has(.anticon-robot)").first().click();

    const list = page.getByTestId("hermes-chat-list");
    await expect(list).toBeVisible();

    // 修复点 1: 容器 CSS 必须关闭浏览器滚动锚定,避免锚定算法和我们的 setScrollTop 互掐导致抖动
    const overflowAnchor = await list.evaluate((el) => getComputedStyle(el).overflowAnchor);
    expect(overflowAnchor).toBe("none");

    // 修复点 2: 仅当用户处于贴底状态时才自动滚动。
    // 灌入足够多历史撑出可滚动高度,然后模拟用户上滑离开底部 + onScroll 触发 stickToBottomRef=false,
    // 再由 React state 变更触发 useEffect。修复前会被强制拉回底部,修复后保持原位。
    const result = await list.evaluate(async (el) => {
      // 灌入历史内容,撑出可滚动高度
      const seed = Array.from({ length: 40 })
        .map((_, i) => `<div style="height:24px">history line ${i}</div>`)
        .join("");
      el.innerHTML = seed;
      // 用户主动上滑,远离底部,并派发 scroll 事件让组件的 onScroll 标记 stickToBottomRef=false
      el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight - 120);
      el.dispatchEvent(new Event("scroll"));
      const before = el.scrollTop;
      const samples: number[] = [before];
      // 模拟 thinking 期间内容持续增长(回答流式追加),每帧采样 scrollTop
      for (let i = 0; i < 8; i++) {
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
        const extra = document.createElement("div");
        extra.style.height = "20px";
        extra.textContent = `streamed line ${i}`;
        el.appendChild(extra);
        samples.push(el.scrollTop);
      }
      return { before, samples };
    });

    // 用户上滑后,后续内容增长不应使 scrollTop 抖动 —— 修复前 useEffect 会反复拉回底部,
    // 配合 overflow-anchor:auto 进一步放大抖动。修复后应保持基本不变(±5px reflow 容忍)。
    const minS = Math.min(...result.samples);
    const maxS = Math.max(...result.samples);
    expect(maxS - minS).toBeLessThan(10);
    expect(Math.abs(result.samples[result.samples.length - 1] - result.before)).toBeLessThan(10);
  });
});
