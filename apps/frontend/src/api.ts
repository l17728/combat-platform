import type { GraphNode, ProgressLog, NodeSchema } from "@combat/shared";

export class Api {
  constructor(private base = "", private f: typeof fetch = fetch) {}
  async listNodes(nodeType: string, filter: Record<string, string> = {}): Promise<GraphNode[]> {
    const qs = new URLSearchParams(filter).toString();
    const r = await this.f(`${this.base}/api/nodes/${nodeType}${qs ? "?" + qs : ""}`, {});
    return r.json();
  }
  async getNode(id: string): Promise<GraphNode> {
    return (await this.f(`${this.base}/api/nodes/${id}`, {})).json();
  }
  async getSchema(nodeType: string): Promise<NodeSchema> {
    return (await this.f(`${this.base}/api/schema/${nodeType}`, {})).json();
  }
  async listProgress(id: string): Promise<ProgressLog[]> {
    return (await this.f(`${this.base}/api/nodes/${id}/progress`, {})).json();
  }
  async appendProgress(id: string, content: string, statusSnapshot: string): Promise<ProgressLog> {
    return (await this.f(`${this.base}/api/nodes/${id}/progress`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ content, statusSnapshot, actor: "ui" }) })).json();
  }
  async importXlsx(file: File): Promise<{ created: number }> {
    const fd = new FormData(); fd.append("file", file);
    return (await this.f(`${this.base}/api/import`, { method: "POST", body: fd })).json();
  }
}
export const api = new Api("");
