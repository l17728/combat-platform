import { randomUUID } from "node:crypto";
import type { DB } from "./db.js";
import type { Repository, NodeFilter, GraphNode, GraphEdge, ProgressLog, RelationProposal, RelationProposalStatus, Reminder, ReminderStatus, AuditLogEntry } from "@combat/shared";

export class SqliteRepository implements Repository {
  constructor(private db: DB) {}

  async logAudit(entry: { action: string; entityType: string; entityId: string; changes: unknown; actor: string }): Promise<void> {
    this.db.prepare(
      `INSERT INTO audit_log VALUES (@id,@action,@entityType,@entityId,@changes,@by,@at)`
    ).run({ id: randomUUID(), action: entry.action, entityType: entry.entityType,
      entityId: entry.entityId, changes: JSON.stringify(entry.changes),
      by: entry.actor, at: new Date().toISOString() });
  }

  async listAuditLog(filter: { action?: string; entityType?: string; entityId?: string; limit?: number }): Promise<AuditLogEntry[]> {
    const where: string[] = [];
    const params: Record<string, string> = {};
    if (filter.action) { where.push("action = @action"); params.action = filter.action; }
    if (filter.entityType) { where.push("entityType = @entityType"); params.entityType = filter.entityType; }
    if (filter.entityId) { where.push("entityId = @entityId"); params.entityId = filter.entityId; }
    const rawLimit = Number(filter.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit >= 1
      ? Math.min(500, Math.floor(rawLimit))
      : 100;
    const sql = `SELECT * FROM audit_log${where.length ? " WHERE " + where.join(" AND ") : ""} ORDER BY performedAt DESC, id LIMIT ${limit}`;
    const rows = this.db.prepare(sql).all(params) as Array<{
      id: string; action: string; entityType: string; entityId: string;
      changes: string; performedBy: string; performedAt: string;
    }>;
    return rows.map(r => {
      let changes: unknown = r.changes;
      try { changes = JSON.parse(r.changes); } catch { /* keep raw string */ }
      return {
        id: r.id, action: r.action, entityType: r.entityType, entityId: r.entityId,
        changes, performedBy: r.performedBy, performedAt: r.performedAt,
      };
    });
  }

  private auditSync(action: string, entityType: string, entityId: string, changes: unknown, actor: string) {
    // Internal sync helper — keeps transaction callbacks synchronous so
    // better-sqlite3 `db.transaction(...)` continues to wrap properly.
    this.db.prepare(
      `INSERT INTO audit_log VALUES (@id,@action,@entityType,@entityId,@changes,@by,@at)`
    ).run({ id: randomUUID(), action, entityType, entityId,
      changes: JSON.stringify(changes), by: actor, at: new Date().toISOString() });
  }

  async getSetting(key: string): Promise<string | null> {
    const row = this.db.prepare(`SELECT value FROM app_settings WHERE key = ?`).get(key) as { value: string } | undefined;
    return row ? row.value : null;
  }
  async setSetting(key: string, value: string, actor: string): Promise<void> {
    this.db.prepare(`INSERT INTO app_settings (key, value) VALUES (@k, @v)
      ON CONFLICT(key) DO UPDATE SET value = @v`).run({ k: key, v: value });
    this.auditSync("SETTING", "setting", key, { key }, actor);
  }

  async createNode(nodeType: string, properties: Record<string, unknown>, actor: string): Promise<GraphNode> {
    const now = new Date().toISOString();
    const node: GraphNode = { id: randomUUID(), nodeType, properties, createdAt: now, updatedAt: now };
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO nodes VALUES (@id,@nodeType,@properties,@search,@c,@u)`)
        .run({ id: node.id, nodeType, properties: JSON.stringify(properties),
          search: Object.values(properties).map(v =>
            typeof v === "object" && v !== null ? JSON.stringify(v) : String(v ?? "")
          ).join(" "), c: now, u: now });
      this.auditSync("CREATE", "node", node.id, properties, actor);
    })();
    return node;
  }

  async getNode(id: string): Promise<GraphNode | null> {
    const r = this.db.prepare(`SELECT * FROM nodes WHERE id=?`).get(id) as any;
    if (!r) return null;
    return { id: r.id, nodeType: r.nodeType, properties: JSON.parse(r.properties),
      createdAt: r.created_at, updatedAt: r.updated_at };
  }

  async updateNode(id: string, patch: Record<string, unknown>, actor: string): Promise<GraphNode> {
    const cur = await this.getNode(id);
    if (!cur) throw new Error(`node ${id} not found`);
    const properties = { ...cur.properties, ...patch };
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare(`UPDATE nodes SET properties=?, search_text=?, updated_at=? WHERE id=?`)
        .run(JSON.stringify(properties), Object.values(properties).map(v =>
          typeof v === "object" && v !== null ? JSON.stringify(v) : String(v ?? "")
        ).join(" "), now, id);
      this.auditSync("UPDATE", "node", id, patch, actor);
    })();
    return { ...cur, properties, updatedAt: now };
  }

  async queryNodes(nodeType: string, filter?: NodeFilter): Promise<GraphNode[]> {
    const rows = this.db.prepare(`SELECT * FROM nodes WHERE nodeType=? ORDER BY created_at DESC`).all(nodeType) as any[];
    let out = rows.map(r => ({ id: r.id, nodeType: r.nodeType,
      properties: JSON.parse(r.properties), createdAt: r.created_at, updatedAt: r.updated_at }));
    if (filter) out = out.filter(n => Object.entries(filter).every(([k, v]) => n.properties[k] === v));
    return out;
  }

  async createEdge(edgeType: string, sourceId: string, targetId: string, properties: Record<string, unknown>, actor: string): Promise<GraphEdge> {
    const now = new Date().toISOString();
    const e: GraphEdge = { id: randomUUID(), edgeType, sourceId, targetId, properties, createdAt: now, updatedAt: now };
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO edges VALUES (@id,@edgeType,@s,@t,@p,@c,@u)`)
        .run({ id: e.id, edgeType, s: sourceId, t: targetId, p: JSON.stringify(properties), c: now, u: now });
      this.auditSync("CREATE", "edge", e.id, { edgeType, sourceId, targetId }, actor);
    })();
    return e;
  }

  async queryEdges(opts: { sourceId?: string; targetId?: string; edgeType?: string }): Promise<GraphEdge[]> {
    // §31: push filters to SQL WHERE so idx_edges_source/idx_edges_target/idx_edges_type apply.
    const wh: string[] = [], params: unknown[] = [];
    if (opts.sourceId) { wh.push("sourceId=?"); params.push(opts.sourceId); }
    if (opts.targetId) { wh.push("targetId=?"); params.push(opts.targetId); }
    if (opts.edgeType) { wh.push("edgeType=?"); params.push(opts.edgeType); }
    const sql = `SELECT * FROM edges${wh.length ? " WHERE " + wh.join(" AND ") : ""}`;
    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(r => ({ id: r.id, edgeType: r.edgeType, sourceId: r.sourceId,
      targetId: r.targetId, properties: JSON.parse(r.properties), createdAt: r.created_at, updatedAt: r.updated_at }));
  }

  async deleteEdges(opts: { sourceId?: string; targetId?: string; edgeType?: string }, actor: string): Promise<void> {
    const victims = await this.queryEdges(opts);
    this.db.transaction(() => {
      for (const e of victims) {
        this.db.prepare(`DELETE FROM edges WHERE id=?`).run(e.id);
        this.auditSync("DELETE", "edge", e.id, { edgeType: e.edgeType, sourceId: e.sourceId, targetId: e.targetId }, actor);
      }
    })();
  }

  async deleteEdgeById(id: string, actor: string): Promise<boolean> {
    const row = this.db.prepare(`SELECT id, edgeType, sourceId, targetId FROM edges WHERE id=?`).get(id) as
      { id: string; edgeType: string; sourceId: string; targetId: string } | undefined;
    if (!row) return false;
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM edges WHERE id=?`).run(id);
      this.auditSync("DELETE", "edge", id, { edgeType: row.edgeType, sourceId: row.sourceId, targetId: row.targetId }, actor);
    })();
    return true;
  }

  async appendProgress(ownerId: string, content: string, statusSnapshot: string, actor: string): Promise<ProgressLog> {
    let p!: ProgressLog;
    this.db.transaction(() => {
      const max = this.db.prepare(`SELECT MAX(seqNo) m FROM progress_log WHERE ownerId=?`).get(ownerId) as any;
      p = { id: randomUUID(), ownerId, seqNo: (max?.m ?? 0) + 1,
        content, statusSnapshot, updatedBy: actor, updatedAt: new Date().toISOString() };
      this.db.prepare(`INSERT INTO progress_log VALUES (@id,@ownerId,@seqNo,@content,@s,@by,@at)`)
        .run({ id: p.id, ownerId, seqNo: p.seqNo, content, s: statusSnapshot, by: actor, at: p.updatedAt });
      this.auditSync("PROGRESS", "node", ownerId, { seqNo: p.seqNo, content }, actor);
    })();
    return p;
  }

  async listProgress(ownerId: string): Promise<ProgressLog[]> {
    const rows = this.db.prepare(`SELECT * FROM progress_log WHERE ownerId=? ORDER BY seqNo`).all(ownerId) as any[];
    return rows.map(r => ({ id: r.id, ownerId: r.ownerId, seqNo: r.seqNo,
      content: r.content, statusSnapshot: r.statusSnapshot, updatedBy: r.updatedBy, updatedAt: r.updatedAt }));
  }

  async listAllProgress(): Promise<ProgressLog[]> {
    const rows = this.db.prepare(`SELECT * FROM progress_log ORDER BY ownerId, seqNo`).all() as any[];
    return rows.map(r => ({ id: r.id, ownerId: r.ownerId, seqNo: r.seqNo,
      content: r.content, statusSnapshot: r.statusSnapshot, updatedBy: r.updatedBy, updatedAt: r.updatedAt }));
  }

  async createProposal(p: Omit<RelationProposal,"id"|"status"|"decidedBy"|"decidedAt"|"createdAt">, actor: string): Promise<RelationProposal> {
    const now = new Date().toISOString();
    const row: RelationProposal = { ...p, id: randomUUID(), status: "待审批", createdAt: now };
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO proposals VALUES (@id,@s,@t,@rt,@c,@ps,@r,@st,@db,@da,@ca)`)
        .run({ id: row.id, s: row.sourceNodeId, t: row.targetNodeId, rt: row.relationType,
          c: row.confidence, ps: row.proposerSource, r: row.rationale, st: row.status,
          db: null, da: null, ca: now });
      this.auditSync("CREATE", "proposal", row.id, { relationType: row.relationType }, actor);
    })();
    return row;
  }
  private mapProposal(r: any): RelationProposal {
    return { id: r.id, sourceNodeId: r.source_node_id, targetNodeId: r.target_node_id,
      relationType: r.relation_type, confidence: r.confidence, proposerSource: r.proposer_source,
      rationale: r.rationale, status: r.status, decidedBy: r.decided_by ?? undefined,
      decidedAt: r.decided_at ?? undefined, createdAt: r.created_at };
  }
  async listProposals(opts: { status?: RelationProposalStatus } = {}): Promise<RelationProposal[]> {
    // §31: push status to SQL WHERE (idx_proposals_status).
    const rows = opts.status
      ? this.db.prepare(`SELECT * FROM proposals WHERE status=?`).all(opts.status) as any[]
      : this.db.prepare(`SELECT * FROM proposals`).all() as any[];
    return rows.map(r => this.mapProposal(r));
  }
  async getProposal(id: string): Promise<RelationProposal | undefined> {
    const r = this.db.prepare(`SELECT * FROM proposals WHERE id=?`).get(id) as any;
    return r ? this.mapProposal(r) : undefined;
  }
  async updateProposalStatus(id: string, status: RelationProposalStatus, decidedBy: string, actor: string): Promise<RelationProposal> {
    const cur = await this.getProposal(id);
    if (!cur) throw new Error(`proposal ${id} not found`);
    const at = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare(`UPDATE proposals SET status=?, decided_by=?, decided_at=? WHERE id=?`)
        .run(status, decidedBy, at, id);
      this.auditSync("UPDATE", "proposal", id, { status, decidedBy }, actor);
    })();
    return { ...cur, status, decidedBy, decidedAt: at };
  }

  async deleteNode(id: string, actor: string): Promise<void> {
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM progress_log WHERE ownerId=?`).run(id);
      this.db.prepare(`DELETE FROM edges WHERE sourceId=? OR targetId=?`).run(id, id);
      this.db.prepare(`DELETE FROM ticket_tabs WHERE ticket_id=?`).run(id);
      const result = this.db.prepare(`DELETE FROM nodes WHERE id=?`).run(id);
      if (result.changes > 0) this.auditSync("DELETE", "node", id, { id }, actor);
    })();
  }

  async createReminder(p: Omit<Reminder,"id"|"status"|"decidedBy"|"decidedAt"|"createdAt">, actor: string): Promise<Reminder> {
    const now = new Date().toISOString();
    const row: Reminder = { ...p, id: randomUUID(), status: "待发送", createdAt: now };
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO notifications VALUES (@id,@k,@t,@rpid,@rn,@sub,@body,@st,@db,@da,@ca)`)
        .run({ id: row.id, k: row.kind, t: row.ticketId,
          rpid: row.recipientPersonId ?? null, rn: row.recipientName,
          sub: row.subject, body: row.body, st: row.status, db: null, da: null, ca: now });
      this.auditSync("CREATE", "reminder", row.id, { kind: row.kind, ticketId: row.ticketId }, actor);
    })();
    return row;
  }
  private mapReminder(r: any): Reminder {
    return { id: r.id, kind: r.kind, ticketId: r.ticket_id,
      recipientPersonId: r.recipient_person_id ?? undefined, recipientName: r.recipient_name ?? "",
      subject: r.subject ?? "", body: r.body ?? "",
      status: r.status, decidedBy: r.decided_by ?? undefined,
      decidedAt: r.decided_at ?? undefined, createdAt: r.created_at };
  }
  async listReminders(opts: { status?: ReminderStatus } = {}): Promise<Reminder[]> {
    // §31: push status to SQL WHERE (idx_notifications_status); keep ORDER BY.
    const rows = opts.status
      ? this.db.prepare(`SELECT * FROM notifications WHERE status=? ORDER BY created_at DESC`).all(opts.status) as any[]
      : this.db.prepare(`SELECT * FROM notifications ORDER BY created_at DESC`).all() as any[];
    return rows.map(r => this.mapReminder(r));
  }
  async getReminder(id: string): Promise<Reminder | undefined> {
    const r = this.db.prepare(`SELECT * FROM notifications WHERE id=?`).get(id) as any;
    return r ? this.mapReminder(r) : undefined;
  }
  async updateReminderStatus(id: string, status: ReminderStatus, decidedBy: string, actor: string): Promise<Reminder> {
    const cur = await this.getReminder(id);
    if (!cur) throw new Error(`reminder ${id} not found`);
    const at = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare(`UPDATE notifications SET status=?, decided_by=?, decided_at=? WHERE id=?`)
        .run(status, decidedBy, at, id);
      this.auditSync("UPDATE", "reminder", id, { status, decidedBy }, actor);
    })();
    return { ...cur, status, decidedBy, decidedAt: at };
  }
}
