import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// 通过 vi.hoisted 提前持有 message mock 引用,vi.mock 工厂里直接拿到
const { messageErrorMock } = vi.hoisted(() => ({
  messageErrorMock: vi.fn(),
}));
vi.mock("antd", () => ({
  message: { error: messageErrorMock },
}));

import { ApiError } from "../../api.js";
import { handleApiError } from "../../utils/handleApiError.js";

describe("handleApiError", () => {
  beforeEach(() => {
    messageErrorMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ApiError 401 → 静默(已被全局 onUnauthorized 接管),不弹 toast", () => {
    const err = new ApiError(401, "HTTP 401", "/api/x");
    const r = handleApiError(err, "操作失败");
    expect(messageErrorMock).not.toHaveBeenCalled();
    expect(r).toBe(err);
  });

  it("ApiError 403 → 优先用 detail 文案", () => {
    const err = new ApiError(403, "HTTP 403 仅 Leader 可标定", "/api/x", "仅 Leader 可标定");
    handleApiError(err, "操作失败");
    expect(messageErrorMock).toHaveBeenCalledWith("仅 Leader 可标定");
  });

  it("ApiError 500 无 detail → 用 e.message", () => {
    const err = new ApiError(500, "HTTP 500 server crash", "/api/x");
    handleApiError(err, "保存失败");
    expect(messageErrorMock).toHaveBeenCalledWith("HTTP 500 server crash");
  });

  it("非 ApiError(网络/SyntaxError 等)→ 用 defaultMsg + 原始 message", () => {
    handleApiError(new TypeError("Failed to fetch"), "加载失败");
    expect(messageErrorMock).toHaveBeenCalledWith("加载失败: Failed to fetch");
  });

  it("未知类型 e=字符串 → 用 defaultMsg + 字符串", () => {
    handleApiError("boom", "保存失败");
    expect(messageErrorMock).toHaveBeenCalledWith("保存失败: boom");
  });

  it('e=null + 无 defaultMsg → fallback "未知错误"', () => {
    handleApiError(null);
    expect(messageErrorMock).toHaveBeenCalledWith("未知错误");
  });
});
