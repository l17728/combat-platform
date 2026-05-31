import { describe, it, expect, vi, beforeEach } from "vitest";

describe("ApiError + onUnauthorized 钩子", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("ApiError 携带 status / detail / path", async () => {
    const { ApiError } = await import("../../api.js");
    const e = new ApiError(403, "HTTP 403 仅 Leader", "/api/x", "仅 Leader");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("ApiError");
    expect(e.status).toBe(403);
    expect(e.detail).toBe("仅 Leader");
    expect(e.path).toBe("/api/x");
  });

  it("req 收到 401 → 触发 onUnauthorized,callsite 仍能 catch 到 ApiError", async () => {
    const { Api, onUnauthorized } = await import("../../api.js");
    const handler = vi.fn();
    onUnauthorized(handler);

    const fakeFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      url: "/api/nodes/x",
      headers: { get: () => "application/json" },
      json: async () => ({ error: "token 已过期" }),
    });
    const api = new Api("", fakeFetch as any);
    await expect(api.getNode("x")).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
      detail: "token 已过期",
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].status).toBe(401);
  });

  it("/api/auth/me 的 401 不触发 onUnauthorized(避免 AuthProvider 启动时跳转循环)", async () => {
    const { Api, onUnauthorized } = await import("../../api.js");
    const handler = vi.fn();
    onUnauthorized(handler);

    const fakeFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      url: "/api/auth/me",
      headers: { get: () => "application/json" },
      json: async () => ({ error: "not logged in" }),
    });
    const api = new Api("", fakeFetch as any);
    await expect(api.getMe()).rejects.toMatchObject({ status: 401 });
    expect(handler).not.toHaveBeenCalled();
  });

  it("403 → 抛 ApiError,但不触发 onUnauthorized", async () => {
    const { Api, onUnauthorized } = await import("../../api.js");
    const handler = vi.fn();
    onUnauthorized(handler);

    const fakeFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      url: "/api/x",
      headers: { get: () => "application/json" },
      json: async () => ({ error: "仅 Leader 可标定" }),
    });
    const api = new Api("", fakeFetch as any);
    await expect(api.getNode("x")).rejects.toMatchObject({
      status: 403,
      detail: "仅 Leader 可标定",
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("2xx 正常路径返回 json", async () => {
    const { Api } = await import("../../api.js");
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      url: "/api/nodes/x",
      headers: { get: () => "application/json" },
      json: async () => ({ id: "x", nodeType: "person", properties: {} }),
    });
    const api = new Api("", fakeFetch as any);
    const r = await api.getNode("x");
    expect(r.id).toBe("x");
  });
});
