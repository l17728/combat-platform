import type { GraphNode, ProgressLog, NodeSchema, FieldOp, LeaderboardEntry, PersonHonor } from "@combat/shared";

export interface RelatedResult {
  outgoing: { field: string; concept: string; node: GraphNode }[];
  incoming: { field: string; concept: string; node: GraphNode }[];
}

export class Api {
  private f: typeof fetch;
  constructor(private base = "", f?: typeof fetch) {
    // Native fetch must keep its global receiver; calling a bare/instance-stored
    // reference as this.f(...) throws "Illegal invocation" in browsers.
    this.f = f ?? globalThis.fetch.bind(globalThis);
  }

  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const r = await this.f(`${this.base}${path}`, init);
    if (!r.ok) {
      const body = await r.json().catch(() => null);
      const detail = body?.error ?? (Array.isArray(body?.errors) ? body.errors.join("; ") : "");
      throw new Error(`HTTP ${r.status}${detail ? ` ${detail}` : ` ${r.url || path}`}`);
    }
    return r.json() as Promise<T>;
  }

  listNodes(nodeType: string, filter: Record<string, string> = {}): Promise<GraphNode[]> {
    const qs = new URLSearchParams(filter).toString();
    return this.req<GraphNode[]>(`/api/nodes/${nodeType}${qs ? "?" + qs : ""}`, {});
  }
  getNode(id: string): Promise<GraphNode> {
    return this.req<GraphNode>(`/api/nodes/${id}`, {});
  }
  getSchema(nodeType: string): Promise<NodeSchema> {
    return this.req<NodeSchema>(`/api/schema/${nodeType}`, {});
  }
  listProgress(id: string): Promise<ProgressLog[]> {
    return this.req<ProgressLog[]>(`/api/nodes/${id}/progress`, {});
  }
  appendProgress(id: string, content: string, statusSnapshot: string): Promise<ProgressLog> {
    return this.req<ProgressLog>(`/api/nodes/${id}/progress`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ content, statusSnapshot, actor: "ui" }) });
  }
  createNode(nodeType: string, props: Record<string, unknown>): Promise<GraphNode> {
    return this.req<GraphNode>(`/api/nodes/${nodeType}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(props) });
  }
  updateNode(id: string, props: Record<string, unknown>): Promise<GraphNode> {
    return this.req<GraphNode>(`/api/nodes/${id}`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify(props) });
  }
  deleteNode(id: string): Promise<{ ok: boolean }> {
    return this.req<{ ok: boolean }>(`/api/nodes/${id}`, { method: "DELETE" });
  }
  patchSchema(nodeType: string, op: FieldOp): Promise<NodeSchema> {
    return this.req<NodeSchema>(`/api/schema/${nodeType}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify(op) });
  }
  getLeaderboard(period?: string): Promise<LeaderboardEntry[]> {
    const qs = period ? `?period=${encodeURIComponent(period)}` : "";
    return this.req<LeaderboardEntry[]>(`/api/honor/leaderboard${qs}`, {});
  }
  getPersonHonor(name: string): Promise<PersonHonor> {
    return this.req<PersonHonor>(`/api/honor/person/${encodeURIComponent(name)}`, {});
  }
  getRelated(nodeType: string, id: string): Promise<RelatedResult> {
    return this.req<RelatedResult>(`/api/related/${nodeType}/${id}`, {});
  }
  importXlsx(file: File): Promise<{ created: number }> {
    const fd = new FormData(); fd.append("file", file);
    return this.req<{ created: number }>(`/api/import`, { method: "POST", body: fd });
  }
}
export const api = new Api("");
