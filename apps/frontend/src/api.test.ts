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
  it("updateNode PUTs to the node endpoint", async () => {
    const calls: any[] = [];
    const fm = vi.fn(async (u: string, i: any) => { calls.push([u, i]); return new Response(JSON.stringify({ id: "abc", nodeType: "attackTicket", properties: {}, createdAt: "t", updatedAt: "t" }), { status: 200 }); });
    const api = new Api("http://x", fm as any);
    await api.updateNode("abc", { 标题: "b" });
    expect(calls[0][0]).toBe("http://x/api/nodes/abc");
    expect(calls[0][1].method).toBe("PUT");
    expect(JSON.parse(calls[0][1].body)).toEqual({ 标题: "b" });
  });
  it("deleteNode DELETEs the node endpoint", async () => {
    const calls: any[] = [];
    const fm = vi.fn(async (u: string, i: any) => { calls.push([u, i]); return new Response(JSON.stringify({ ok: true }), { status: 200 }); });
    const api = new Api("http://x", fm as any);
    const result = await api.deleteNode("abc");
    expect(calls[0][0]).toBe("http://x/api/nodes/abc");
    expect(calls[0][1].method).toBe("DELETE");
    expect(result.ok).toBe(true);
  });
  it("getLeaderboard / getPersonHonor hit honor endpoints", async () => {
    const calls: any[] = [];
    const fm = vi.fn(async (u: string) => { calls.push(u); return new Response(JSON.stringify([]), { status: 200 }); });
    const api = new Api("http://x", fm as any);
    await api.getLeaderboard("2026-Q2");
    await api.getPersonHonor("张三");
    expect(calls[0]).toBe("http://x/api/honor/leaderboard?period=2026-Q2");
    expect(calls[1]).toBe("http://x/api/honor/person/%E5%BC%A0%E4%B8%89");
  });
  it("getRelated hits the related endpoint", async () => {
    const calls: any[] = [];
    const fm = vi.fn(async (u: string) => { calls.push(u); return new Response(JSON.stringify({ outgoing: [], incoming: [] }), { status: 200 }); });
    const api = new Api("http://x", fm as any);
    await api.getRelated("person", "p1");
    expect(calls[0]).toBe("http://x/api/related/person/p1");
  });
  it("patchSchema setConcept PATCHes the schema endpoint with the op", async () => {
    const calls: any[] = [];
    const fm = vi.fn(async (u: string, i: any) => { calls.push([u, i]); return new Response(JSON.stringify({ nodeType: "attackTicket", label: "攻关单", fields: [], identityKeys: [], derivedToKG: true }), { status: 200 }); });
    const api = new Api("http://x", fm as any);
    await api.patchSchema("attackTicket", { op: "setConcept", id: "当前处理人", concept: "负责人" });
    expect(calls[0][0]).toBe("http://x/api/schema/attackTicket");
    expect(calls[0][1].method).toBe("PATCH");
    expect(JSON.parse(calls[0][1].body)).toEqual({ op: "setConcept", id: "当前处理人", concept: "负责人" });
  });
  it("getRelated includeCandidates appends the query flag (no-opts URL unchanged)", async () => {
    const calls: string[] = [];
    const fm = vi.fn(async (u: string) => { calls.push(u); return new Response(JSON.stringify({ outgoing: [], incoming: [], candidates: [] }), { status: 200 }); });
    const api = new Api("http://x", fm as any);
    await api.getRelated("person", "p1", { includeCandidates: true });
    expect(calls[0]).toBe("http://x/api/related/person/p1?includeCandidates=1");
  });
  it("listProposals / scanProposals / decideProposal hit the proposal endpoints", async () => {
    const calls: any[] = [];
    const fm = vi.fn(async (u: string, i: any) => { calls.push([u, i]); return new Response(JSON.stringify([]), { status: 200 }); });
    const api = new Api("http://x", fm as any);
    await api.listProposals("待审批");
    expect(calls[0][0]).toBe("http://x/api/proposals?status=%E5%BE%85%E5%AE%A1%E6%89%B9");
    await api.scanProposals();
    expect(calls[1][0]).toBe("http://x/api/proposals/scan");
    expect(calls[1][1].method).toBe("POST");
    await api.decideProposal("pr1", "通过", "运营");
    expect(calls[2][0]).toBe("http://x/api/proposals/pr1/decide");
    expect(calls[2][1].method).toBe("POST");
    expect(JSON.parse(calls[2][1].body)).toEqual({ decision: "通过", decidedBy: "运营" });
    await api.decideProposal("pr1", "修正", "运营", { targetNodeId: "node-x" });
    expect(JSON.parse(calls[3][1].body)).toEqual({ decision: "修正", decidedBy: "运营", patch: { targetNodeId: "node-x" } });
  });
});
