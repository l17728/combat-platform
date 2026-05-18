import { describe, it, expect, vi } from "vitest";
import { Api } from "./api.js";

describe("Api client", () => {
  it("listNodes hits the right endpoint and returns nodes", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([{ id: "1", nodeType: "attackTicket", properties: { 标题: "a" }, createdAt: "t", updatedAt: "t" }]), { status: 200 }));
    const api = new Api("http://x", fetchMock as any);
    const rows = await api.listNodes("attackTicket", { 状态: "进行中" });
    expect(fetchMock).toHaveBeenCalledWith("http://x/api/nodes/attackTicket?%E7%8A%B6%E6%80%81=%E8%BF%9B%E8%A1%8C%E4%B8%AD", expect.anything());
    expect(rows[0].properties["标题"]).toBe("a");
  });
});
