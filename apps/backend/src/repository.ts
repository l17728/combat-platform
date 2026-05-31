import { randomUUID } from "node:crypto";
import type { DbAdapter } from "./db-adapter.js";
import type {
  Repository,
  NodeFilter,
  GraphNode,
  GraphEdge,
  ProgressLog,
  RelationProposal,
  RelationProposalStatus,
  Reminder,
  ReminderStatus,
  AuditLogEntry,
} from "@combat/shared";

/**
 * Phase 4 — adapter-aware JSON encode/decode.
 *
 * SQLite stores JSON as TEXT (we serialize/deserialize manually).
 * Postgres stores JSON as JSONB (pg driver auto-serializes objects → jsonb on
 * write, and auto-deserializes jsonb → JS object on read). So the encode/decode
 * paths must branch on adapter.kind to avoid double-encoding on the PG side.
 */
export function encodeJsonForAdapter(adapter: DbAdapter, value: unknown): unknown {
  if (adapter.kind === "postgres") return value;
  return JSON.stringify(value ?? {});
}

export function decodeJsonFromAdapter(adapter: DbAdapter, value: unknown): any {
  if (value === null || value === undefined) return {};
  if (adapter.kind === "postgres") {
    // pg already deserialized jsonb columns to JS objects/arrays. But during
    // migration windows or via raw text APIs the row may still be a string —
    // be defensive.
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch {
        return {};
      }
    }
    return value;
  }
  // sqlite path
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

/**
 * SqliteRepository — historical name, now dialect-neutral. Internally drives all
 * SQL through a `DbAdapter`, so the SAME class transparently runs on:
 *   - SQLite (via SqliteAdapter) — the default test+prod path
 *   - Postgres (via PostgresAdapter) — Phase 2c, opt-in via DB_URL=postgres://...
 *
 * All placeholders are positional `?` (PostgresAdapter rewrites to $1, $2, ...).
 * Upserts use `INSERT ... ON CONFLICT(col) DO UPDATE` which is supported by
 * both SQLite (≥ 3.24, our minimum) and Postgres.
 */
export class SqliteRepository implements Repository {
  constructor(private adapter: DbAdapter) {}

  private flatten(properties: Record<string, unknown>): string {
    return Object.values(properties)
      .map((v) => (typeof v === "object" && v !== null ? JSON.stringify(v) : String(v ?? "")))
      .join(" ");
  }

  private async auditTx(
    tx: DbAdapter,
    action: string,
    entityType: string,
    entityId: string,
    changes: unknown,
    actor: string
  ): Promise<void> {
    await tx.run(
      `INSERT INTO audit_log (id, action, "entityType", "entityId", changes, "performedBy", "performedAt") VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), action, entityType, entityId, encodeJsonForAdapter(tx, changes), actor, new Date().toISOString()]
    );
  }

  async logAudit(entry: {
    action: string;
    entityType: string;
    entityId: string;
    changes: unknown;
    actor: string;
  }): Promise<void> {
    await this.adapter.run(
      `INSERT INTO audit_log (id, action, "entityType", "entityId", changes, "performedBy", "performedAt") VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        entry.action,
        entry.entityType,
        entry.entityId,
        encodeJsonForAdapter(this.adapter, entry.changes),
        entry.actor,
        new Date().toISOString(),
      ]
    );
  }

  async listAuditLog(filter: {
    action?: string;
    entityType?: string;
    entityId?: string;
    limit?: number;
  }): Promise<AuditLogEntry[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.action) {
      where.push("action = ?");
      params.push(filter.action);
    }
    if (filter.entityType) {
      where.push(`"entityType" = ?`);
      params.push(filter.entityType);
    }
    if (filter.entityId) {
      where.push(`"entityId" = ?`);
      params.push(filter.entityId);
    }
    const rawLimit = Number(filter.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.min(500, Math.floor(rawLimit)) : 100;
    const sql = `SELECT * FROM audit_log${where.length ? " WHERE " + where.join(" AND ") : ""} ORDER BY "performedAt" DESC, id LIMIT ${limit}`;
    const rows = await this.adapter.query<{
      id: string;
      action: string;
      entityType: string;
      entityId: string;
      changes: unknown;
      performedBy: string;
      performedAt: string;
    }>(sql, params);
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      changes: decodeJsonFromAdapter(this.adapter, r.changes),
      performedBy: r.performedBy,
      performedAt: r.performedAt,
    }));
  }

  async getSetting(key: string): Promise<string | null> {
    const row = await this.adapter.queryOne<{ value: string }>(`SELECT value FROM app_settings WHERE key = ?`, [key]);
    return row ? row.value : null;
  }

  async setSetting(key: string, value: string, actor: string): Promise<void> {
    await this.adapter.run(
      `INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?`,
      [key, value, value]
    );
    await this.logAudit({ action: "SETTING", entityType: "setting", entityId: key, changes: { key }, actor });
  }

  async createNode(nodeType: string, properties: Record<string, unknown>, actor: string): Promise<GraphNode> {
    const now = new Date().toISOString();
    const node: GraphNode = { id: randomUUID(), nodeType, properties, createdAt: now, updatedAt: now };
    await this.adapter.transaction(async (tx) => {
      await tx.run(
        `INSERT INTO nodes (id, "nodeType", properties, search_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [node.id, nodeType, encodeJsonForAdapter(tx, properties), this.flatten(properties), now, now]
      );
      await this.auditTx(tx, "CREATE", "node", node.id, properties, actor);
    });
    return node;
  }

  async getNode(id: string): Promise<GraphNode | null> {
    const r = await this.adapter.queryOne<any>(`SELECT * FROM nodes WHERE id = ?`, [id]);
    if (!r) return null;
    return {
      id: r.id,
      nodeType: r.nodeType,
      properties: decodeJsonFromAdapter(this.adapter, r.properties),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  async updateNode(id: string, patch: Record<string, unknown>, actor: string): Promise<GraphNode> {
    const cur = await this.getNode(id);
    if (!cur) throw new Error(`node ${id} not found`);
    const properties = { ...cur.properties, ...patch };
    const now = new Date().toISOString();
    await this.adapter.transaction(async (tx) => {
      await tx.run(`UPDATE nodes SET properties = ?, search_text = ?, updated_at = ? WHERE id = ?`, [
        encodeJsonForAdapter(tx, properties),
        this.flatten(properties),
        now,
        id,
      ]);
      await this.auditTx(tx, "UPDATE", "node", id, patch, actor);
    });
    return { ...cur, properties, updatedAt: now };
  }

  async queryNodes(nodeType: string, filter?: NodeFilter): Promise<GraphNode[]> {
    const rows = await this.adapter.query<any>(`SELECT * FROM nodes WHERE "nodeType" = ? ORDER BY created_at DESC`, [
      nodeType,
    ]);
    let out = rows.map((r) => ({
      id: r.id,
      nodeType: r.nodeType,
      properties: decodeJsonFromAdapter(this.adapter, r.properties),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
    if (filter) out = out.filter((n) => Object.entries(filter).every(([k, v]) => n.properties[k] === v));
    return out;
  }

  async createEdge(
    edgeType: string,
    sourceId: string,
    targetId: string,
    properties: Record<string, unknown>,
    actor: string
  ): Promise<GraphEdge> {
    const now = new Date().toISOString();
    const e: GraphEdge = { id: randomUUID(), edgeType, sourceId, targetId, properties, createdAt: now, updatedAt: now };
    await this.adapter.transaction(async (tx) => {
      await tx.run(
        `INSERT INTO edges (id, "edgeType", "sourceId", "targetId", properties, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [e.id, edgeType, sourceId, targetId, encodeJsonForAdapter(tx, properties), now, now]
      );
      await this.auditTx(tx, "CREATE", "edge", e.id, { edgeType, sourceId, targetId }, actor);
    });
    return e;
  }

  async queryEdges(opts: { sourceId?: string; targetId?: string; edgeType?: string }): Promise<GraphEdge[]> {
    // §31: push filters to SQL WHERE so idx_edges_source/idx_edges_target/idx_edges_type apply.
    const wh: string[] = [],
      params: unknown[] = [];
    if (opts.sourceId) {
      wh.push(`"sourceId" = ?`);
      params.push(opts.sourceId);
    }
    if (opts.targetId) {
      wh.push(`"targetId" = ?`);
      params.push(opts.targetId);
    }
    if (opts.edgeType) {
      wh.push(`"edgeType" = ?`);
      params.push(opts.edgeType);
    }
    const sql = `SELECT * FROM edges${wh.length ? " WHERE " + wh.join(" AND ") : ""}`;
    const rows = await this.adapter.query<any>(sql, params);
    return rows.map((r) => ({
      id: r.id,
      edgeType: r.edgeType,
      sourceId: r.sourceId,
      targetId: r.targetId,
      properties: decodeJsonFromAdapter(this.adapter, r.properties),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async deleteEdges(opts: { sourceId?: string; targetId?: string; edgeType?: string }, actor: string): Promise<void> {
    const victims = await this.queryEdges(opts);
    await this.adapter.transaction(async (tx) => {
      for (const e of victims) {
        await tx.run(`DELETE FROM edges WHERE id = ?`, [e.id]);
        await this.auditTx(
          tx,
          "DELETE",
          "edge",
          e.id,
          { edgeType: e.edgeType, sourceId: e.sourceId, targetId: e.targetId },
          actor
        );
      }
    });
  }

  async deleteEdgeById(id: string, actor: string): Promise<boolean> {
    const row = await this.adapter.queryOne<{ id: string; edgeType: string; sourceId: string; targetId: string }>(
      `SELECT id, "edgeType", "sourceId", "targetId" FROM edges WHERE id = ?`,
      [id]
    );
    if (!row) return false;
    await this.adapter.transaction(async (tx) => {
      await tx.run(`DELETE FROM edges WHERE id = ?`, [id]);
      await this.auditTx(
        tx,
        "DELETE",
        "edge",
        id,
        { edgeType: row.edgeType, sourceId: row.sourceId, targetId: row.targetId },
        actor
      );
    });
    return true;
  }

  async appendProgress(ownerId: string, content: string, statusSnapshot: string, actor: string): Promise<ProgressLog> {
    let p!: ProgressLog;
    await this.adapter.transaction(async (tx) => {
      const max = await tx.queryOne<{ m: number | null }>(
        `SELECT MAX("seqNo") as m FROM progress_log WHERE "ownerId" = ?`,
        [ownerId]
      );
      p = {
        id: randomUUID(),
        ownerId,
        seqNo: (max?.m ?? 0) + 1,
        content,
        statusSnapshot,
        updatedBy: actor,
        updatedAt: new Date().toISOString(),
      };
      await tx.run(
        `INSERT INTO progress_log (id, "ownerId", "seqNo", content, "statusSnapshot", "updatedBy", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [p.id, ownerId, p.seqNo, content, statusSnapshot, actor, p.updatedAt]
      );
      await this.auditTx(tx, "PROGRESS", "node", ownerId, { seqNo: p.seqNo, content }, actor);
    });
    return p;
  }

  async listProgress(ownerId: string): Promise<ProgressLog[]> {
    const rows = await this.adapter.query<any>(`SELECT * FROM progress_log WHERE "ownerId" = ? ORDER BY "seqNo"`, [
      ownerId,
    ]);
    return rows.map((r) => ({
      id: r.id,
      ownerId: r.ownerId,
      seqNo: r.seqNo,
      content: r.content,
      statusSnapshot: r.statusSnapshot,
      updatedBy: r.updatedBy,
      updatedAt: r.updatedAt,
    }));
  }

  async listAllProgress(): Promise<ProgressLog[]> {
    const rows = await this.adapter.query<any>(`SELECT * FROM progress_log ORDER BY "ownerId", "seqNo"`);
    return rows.map((r) => ({
      id: r.id,
      ownerId: r.ownerId,
      seqNo: r.seqNo,
      content: r.content,
      statusSnapshot: r.statusSnapshot,
      updatedBy: r.updatedBy,
      updatedAt: r.updatedAt,
    }));
  }

  async createProposal(
    p: Omit<RelationProposal, "id" | "status" | "decidedBy" | "decidedAt" | "createdAt">,
    actor: string
  ): Promise<RelationProposal> {
    const now = new Date().toISOString();
    const row: RelationProposal = { ...p, id: randomUUID(), status: "待审批", createdAt: now };
    await this.adapter.transaction(async (tx) => {
      await tx.run(
        `INSERT INTO proposals (id, source_node_id, target_node_id, relation_type, confidence, proposer_source, rationale, status, decided_by, decided_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id,
          row.sourceNodeId,
          row.targetNodeId,
          row.relationType,
          row.confidence,
          row.proposerSource,
          row.rationale,
          row.status,
          null,
          null,
          now,
        ]
      );
      await this.auditTx(tx, "CREATE", "proposal", row.id, { relationType: row.relationType }, actor);
    });
    return row;
  }

  private mapProposal(r: any): RelationProposal {
    return {
      id: r.id,
      sourceNodeId: r.source_node_id,
      targetNodeId: r.target_node_id,
      relationType: r.relation_type,
      confidence: r.confidence,
      proposerSource: r.proposer_source,
      rationale: r.rationale,
      status: r.status,
      decidedBy: r.decided_by ?? undefined,
      decidedAt: r.decided_at ?? undefined,
      createdAt: r.created_at,
    };
  }

  async listProposals(opts: { status?: RelationProposalStatus } = {}): Promise<RelationProposal[]> {
    // §31: push status to SQL WHERE (idx_proposals_status).
    const rows = opts.status
      ? await this.adapter.query<any>(`SELECT * FROM proposals WHERE status = ?`, [opts.status])
      : await this.adapter.query<any>(`SELECT * FROM proposals`);
    return rows.map((r) => this.mapProposal(r));
  }

  async getProposal(id: string): Promise<RelationProposal | undefined> {
    const r = await this.adapter.queryOne<any>(`SELECT * FROM proposals WHERE id = ?`, [id]);
    return r ? this.mapProposal(r) : undefined;
  }

  async updateProposalStatus(
    id: string,
    status: RelationProposalStatus,
    decidedBy: string,
    actor: string
  ): Promise<RelationProposal> {
    const cur = await this.getProposal(id);
    if (!cur) throw new Error(`proposal ${id} not found`);
    const at = new Date().toISOString();
    await this.adapter.transaction(async (tx) => {
      await tx.run(`UPDATE proposals SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?`, [
        status,
        decidedBy,
        at,
        id,
      ]);
      await this.auditTx(tx, "UPDATE", "proposal", id, { status, decidedBy }, actor);
    });
    return { ...cur, status, decidedBy, decidedAt: at };
  }

  async deleteNode(id: string, actor: string): Promise<void> {
    await this.adapter.transaction(async (tx) => {
      await tx.run(`DELETE FROM progress_log WHERE "ownerId" = ?`, [id]);
      await tx.run(`DELETE FROM edges WHERE "sourceId" = ? OR "targetId" = ?`, [id, id]);
      await tx.run(`DELETE FROM ticket_tabs WHERE ticket_id = ?`, [id]);
      const result = await tx.run(`DELETE FROM nodes WHERE id = ?`, [id]);
      if (result.changes > 0) await this.auditTx(tx, "DELETE", "node", id, { id }, actor);
    });
  }

  async createReminder(
    p: Omit<Reminder, "id" | "status" | "decidedBy" | "decidedAt" | "createdAt">,
    actor: string
  ): Promise<Reminder> {
    const now = new Date().toISOString();
    const row: Reminder = { ...p, id: randomUUID(), status: "待发送", createdAt: now };
    await this.adapter.transaction(async (tx) => {
      await tx.run(
        `INSERT INTO notifications (id, kind, ticket_id, recipient_person_id, recipient_name, subject, body, status, decided_by, decided_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id,
          row.kind,
          row.ticketId,
          row.recipientPersonId ?? null,
          row.recipientName,
          row.subject,
          row.body,
          row.status,
          null,
          null,
          now,
        ]
      );
      await this.auditTx(tx, "CREATE", "reminder", row.id, { kind: row.kind, ticketId: row.ticketId }, actor);
    });
    return row;
  }

  private mapReminder(r: any): Reminder {
    return {
      id: r.id,
      kind: r.kind,
      ticketId: r.ticket_id,
      recipientPersonId: r.recipient_person_id ?? undefined,
      recipientName: r.recipient_name ?? "",
      subject: r.subject ?? "",
      body: r.body ?? "",
      status: r.status,
      decidedBy: r.decided_by ?? undefined,
      decidedAt: r.decided_at ?? undefined,
      createdAt: r.created_at,
    };
  }

  async listReminders(opts: { status?: ReminderStatus } = {}): Promise<Reminder[]> {
    // §31: push status to SQL WHERE (idx_notifications_status); keep ORDER BY.
    const rows = opts.status
      ? await this.adapter.query<any>(`SELECT * FROM notifications WHERE status = ? ORDER BY created_at DESC`, [
          opts.status,
        ])
      : await this.adapter.query<any>(`SELECT * FROM notifications ORDER BY created_at DESC`);
    return rows.map((r) => this.mapReminder(r));
  }

  async getReminder(id: string): Promise<Reminder | undefined> {
    const r = await this.adapter.queryOne<any>(`SELECT * FROM notifications WHERE id = ?`, [id]);
    return r ? this.mapReminder(r) : undefined;
  }

  async updateReminderStatus(id: string, status: ReminderStatus, decidedBy: string, actor: string): Promise<Reminder> {
    const cur = await this.getReminder(id);
    if (!cur) throw new Error(`reminder ${id} not found`);
    const at = new Date().toISOString();
    await this.adapter.transaction(async (tx) => {
      await tx.run(`UPDATE notifications SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?`, [
        status,
        decidedBy,
        at,
        id,
      ]);
      await this.auditTx(tx, "UPDATE", "reminder", id, { status, decidedBy }, actor);
    });
    return { ...cur, status, decidedBy, decidedAt: at };
  }
}
