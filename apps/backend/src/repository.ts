import { randomUUID } from "node:crypto";
import type { DB } from "./db.js";
import type { Repository, NodeFilter, GraphNode, GraphEdge, ProgressLog } from "@combat/shared";

export class SqliteRepository implements Repository {
  constructor(private db: DB) {}

  private audit(action: string, entityType: string, entityId: string, changes: unknown, actor: string) {
    this.db.prepare(
      `INSERT INTO audit_log VALUES (@id,@action,@entityType,@entityId,@changes,@by,@at)`
    ).run({ id: randomUUID(), action, entityType, entityId,
      changes: JSON.stringify(changes), by: actor, at: new Date().toISOString() });
  }

  createNode(nodeType: string, properties: Record<string, unknown>, actor: string): GraphNode {
    const now = new Date().toISOString();
    const node: GraphNode = { id: randomUUID(), nodeType, properties, createdAt: now, updatedAt: now };
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO nodes VALUES (@id,@nodeType,@properties,@search,@c,@u)`)
        .run({ id: node.id, nodeType, properties: JSON.stringify(properties),
          search: Object.values(properties).join(" "), c: now, u: now });
      this.audit("CREATE", "node", node.id, properties, actor);
    })();
    return node;
  }

  getNode(id: string): GraphNode | null {
    const r = this.db.prepare(`SELECT * FROM nodes WHERE id=?`).get(id) as any;
    if (!r) return null;
    return { id: r.id, nodeType: r.nodeType, properties: JSON.parse(r.properties),
      createdAt: r.created_at, updatedAt: r.updated_at };
  }

  updateNode(id: string, patch: Record<string, unknown>, actor: string): GraphNode {
    const cur = this.getNode(id);
    if (!cur) throw new Error(`node ${id} not found`);
    const properties = { ...cur.properties, ...patch };
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare(`UPDATE nodes SET properties=?, search_text=?, updated_at=? WHERE id=?`)
        .run(JSON.stringify(properties), Object.values(properties).join(" "), now, id);
      this.audit("UPDATE", "node", id, patch, actor);
    })();
    return { ...cur, properties, updatedAt: now };
  }

  queryNodes(nodeType: string, filter?: NodeFilter): GraphNode[] {
    const rows = this.db.prepare(`SELECT * FROM nodes WHERE nodeType=?`).all(nodeType) as any[];
    let out = rows.map(r => ({ id: r.id, nodeType: r.nodeType,
      properties: JSON.parse(r.properties), createdAt: r.created_at, updatedAt: r.updated_at }));
    if (filter) out = out.filter(n => Object.entries(filter).every(([k, v]) => n.properties[k] === v));
    return out;
  }

  createEdge(edgeType: string, sourceId: string, targetId: string, properties: Record<string, unknown>, actor: string): GraphEdge {
    const now = new Date().toISOString();
    const e: GraphEdge = { id: randomUUID(), edgeType, sourceId, targetId, properties, createdAt: now, updatedAt: now };
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO edges VALUES (@id,@edgeType,@s,@t,@p,@c,@u)`)
        .run({ id: e.id, edgeType, s: sourceId, t: targetId, p: JSON.stringify(properties), c: now, u: now });
      this.audit("CREATE", "edge", e.id, { edgeType, sourceId, targetId }, actor);
    })();
    return e;
  }

  queryEdges(opts: { sourceId?: string; targetId?: string; edgeType?: string }): GraphEdge[] {
    const rows = this.db.prepare(`SELECT * FROM edges`).all() as any[];
    return rows.map(r => ({ id: r.id, edgeType: r.edgeType, sourceId: r.sourceId,
      targetId: r.targetId, properties: JSON.parse(r.properties), createdAt: r.created_at, updatedAt: r.updated_at }))
      .filter(e => (!opts.sourceId || e.sourceId === opts.sourceId)
        && (!opts.targetId || e.targetId === opts.targetId)
        && (!opts.edgeType || e.edgeType === opts.edgeType));
  }

  appendProgress(ownerId: string, content: string, statusSnapshot: string, actor: string): ProgressLog {
    let p!: ProgressLog;
    this.db.transaction(() => {
      const max = this.db.prepare(`SELECT MAX(seqNo) m FROM progress_log WHERE ownerId=?`).get(ownerId) as any;
      p = { id: randomUUID(), ownerId, seqNo: (max?.m ?? 0) + 1,
        content, statusSnapshot, updatedBy: actor, updatedAt: new Date().toISOString() };
      this.db.prepare(`INSERT INTO progress_log VALUES (@id,@ownerId,@seqNo,@content,@s,@by,@at)`)
        .run({ id: p.id, ownerId, seqNo: p.seqNo, content, s: statusSnapshot, by: actor, at: p.updatedAt });
      this.audit("PROGRESS", "node", ownerId, { seqNo: p.seqNo, content }, actor);
    })();
    return p;
  }

  listProgress(ownerId: string): ProgressLog[] {
    const rows = this.db.prepare(`SELECT * FROM progress_log WHERE ownerId=? ORDER BY seqNo`).all(ownerId) as any[];
    return rows.map(r => ({ id: r.id, ownerId: r.ownerId, seqNo: r.seqNo,
      content: r.content, statusSnapshot: r.statusSnapshot, updatedBy: r.updatedBy, updatedAt: r.updatedAt }));
  }
}
