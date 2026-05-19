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
  it("createNode POSTs to the nodeType collection", async () => {
    const calls: any[] = [];
    const fm = vi.fn(async (u: string, i: any) => { calls.push([u, i]); return new Response(JSON.stringify({ id: "1", nodeType: "attackTicket", properties: {}, createdAt: "t", updatedAt: "t" }), { status: 201 }); });
    const api = new Api("http://x", fm as any);
    await api.createNode("attackTicket", { 标题: "a" });
    expect(calls[0][0]).toBe("http://x/api/nodes/attackTicket");
    expect(calls[0][1].method).toBe("POST");
    expect(JSON.parse(calls[0][1].body)).toEqual({ 标题: "a" });
  });
  it("patchSchema PATCHes the schema endpoint with the op", async () => {
    const calls: any[] = [];
    const fm = vi.fn(async (u: string, i: any) => { calls.push([u, i]); return new Response(JSON.stringify({ nodeType: "attackTicket", label: "攻关单", fields: [], identityKeys: [], derivedToKG: true }), { status: 200 }); });
    const api = new Api("http://x", fm as any);
    await api.patchSchema("attackTicket", { op: "retire", id: "状态" });
    expect(calls[0][0]).toBe("http://x/api/schema/attackTicket");
    expect(calls[0][1].method).toBe("PATCH");
    expect(JSON.parse(calls[0][1].body)).toEqual({ op: "retire", id: "状态" });
  });
});
