import type { GraphNode, ProgressLog, NodeSchema } from "@combat/shared";

export class Api {
  private f: typeof fetch;
  constructor(private base = "", f?: typeof fetch) {
    // Native fetch must keep its global receiver; calling a bare/instance-stored
    // reference as this.f(...) throws "Illegal invocation" in browsers.
    this.f = f ?? globalThis.fetch.bind(globalThis);
  }

  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const r = await this.f(`${this.base}${path}`, init);
    if (!r.ok) throw new Error(`HTTP ${r.status} ${r.url || path}`);
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
  importXlsx(file: File): Promise<{ created: number }> {
    const fd = new FormData(); fd.append("file", file);
    return this.req<{ created: number }>(`/api/import`, { method: "POST", body: fd });
  }
}
export const api = new Api("");
