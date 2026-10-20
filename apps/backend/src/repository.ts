import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
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
import { computeAuditHash, EMPTY_PREV_HASH } from "./audit-chain.js";

export const tenantContext = new AsyncLocalStorage<string | null>();

export function tid(): string {
  return tenantContext.getStore() ?? "default";
}

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
  constructor(
    private adapter: DbAdapter,
    private tenantId?: string | null
  ) {}

  private effectiveTenantId(): string | null | undefined {
    if (this.tenantId !== undefined && this.tenantId !== null) return this.tenantId;
    return tenantContext.getStore() ?? undefined;
  }

  private hasTenant(): boolean {
    return !!this.effectiveTenantId();
  }

  private tenantWhere(prefix?: string): string {
    if (!this.hasTenant()) return "";
    return (prefix ? prefix + " " : "") + "tenant_id = ?";
  }

  private tenantParam(): unknown[] {
    const tid = this.effectiveTenantId();
    return tid ? [tid] : [];
  }

  private andTenant(): string {
    return this.hasTenant() ? " AND tenant_id = ?" : "";
  }

  private andTenantParams(): unknown[] {
    return this.tenantParam();
  }

  // resilience(audit-merkle): monotonic per-process clock for audit performedAt.
  // ISO timestamp can collide at sub-ms granularity, which makes (performedAt, id)
  // ordering ambiguous (id is a UUID, not insertion-ordered). We bump by 1ms
  // whenever Date.now() would not advance, so writer-side tail read and
  // verifier-side walk see the SAME stable ordering.
  private lastAuditTsMs = 0;
  private nextMonotonicAuditIso(): string {
    const now = Date.now();
    const next = now > this.lastAuditTsMs ? now : this.lastAuditTsMs + 1;
    this.lastAuditTsMs = next;
    return new Date(next).toISOString();
  }

  private flatten(properties: Record<string, unknown>): string {
    return Object.values(properties)
      .map((v) => (typeof v === "object" && v !== null ? JSON.stringify(v) : String(v ?? "")))
      .join(" ");
  }

  /**
   * resilience(audit-merkle): write a chained audit row. Reads current tail.hash
   * inside the transaction to ensure no concurrent insert breaks the chain,
   * then writes prev_hash + hash atomically with the row.
   */
  private async auditTx(
    tx: DbAdapter,
    action: string,
    entityType: string,
    entityId: string,
    changes: unknown,
    actor: string
  ): Promise<void> {
    const tail = await tx.queryOne<{ hash: string }>(
      `SELECT hash FROM audit_log ORDER BY "performedAt" DESC, id DESC LIMIT 1`
    );
    const prevHash = tail?.hash ?? EMPTY_PREV_HASH;
    const performedAt = this.nextMonotonicAuditIso();
    const id = randomUUID();
    const hash = computeAuditHash({ prevHash, action, entityType, entityId, changes, performedAt });
    await tx.run(
      `INSERT INTO audit_log (id, action, "entityType", "entityId", changes, "performedBy", "performedAt", prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, action, entityType, entityId, encodeJsonForAdapter(tx, changes), actor, performedAt, prevHash, hash]
    );
  }

  // P1 audit actor 强制取自 req.user:调用方传 entry.actor 仅作 fallback,
  // 当 req 存在且带 user.username 时 — 以 req.user.username 为准,避免任传字符串伪造。
  async logAudit(
    entry: {
      action: string;
      entityType: string;
      entityId: string;
      changes: unknown;
      actor: string;
    },
    req?: { user?: { username?: string } } | undefined
  ): Promise<void> {
    const actor = req?.user?.username || entry.actor;
    // resilience(audit-merkle): wrap in transaction so tail read + insert is atomic.
    await this.adapter.transaction(async (tx) => {
      await this.auditTx(tx, entry.action, entry.entityType, entry.entityId, entry.changes, actor);
    });
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
    const tid = this.effectiveTenantId() ?? "default";
    await this.adapter.transaction(async (tx) => {
      await tx.run(
        `INSERT INTO nodes (id, "nodeType", properties, search_text, tenant_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [node.id, nodeType, encodeJsonForAdapter(tx, properties), this.flatten(properties), tid, now, now]
      );
      await this.auditTx(tx, "CREATE", "node", node.id, properties, actor);
    });
    return node;
  }

  async getNode(id: string): Promise<GraphNode | null> {
    const sql = this.hasTenant()
      ? `SELECT * FROM nodes WHERE id = ? AND tenant_id = ?`
      : `SELECT * FROM nodes WHERE id = ?`;
    const params = this.hasTenant() ? [id, this.effectiveTenantId()!] : [id];
    const r = await this.adapter.queryOne<any>(sql, params);
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
    const whereSql = this.hasTenant() ? `WHERE id = ? AND tenant_id = ?` : `WHERE id = ?`;
    const whereParams = this.hasTenant() ? [id, this.effectiveTenantId()!] : [id];
    await this.adapter.transaction(async (tx) => {
      await tx.run(`UPDATE nodes SET properties = ?, search_text = ?, updated_at = ? ${whereSql}`, [
        encodeJsonForAdapter(tx, properties),
        this.flatten(properties),
        now,
        ...whereParams,
      ]);
      await this.auditTx(tx, "UPDATE", "node", id, patch, actor);
    });
    return { ...cur, properties, updatedAt: now };
  }

  async queryNodes(nodeType: string, filter?: NodeFilter): Promise<GraphNode[]> {
    const sql = this.hasTenant()
      ? `SELECT * FROM nodes WHERE "nodeType" = ? AND tenant_id = ? ORDER BY created_at DESC`
      : `SELECT * FROM nodes WHERE "nodeType" = ? ORDER BY created_at DESC`;
    const params = this.hasTenant() ? [nodeType, this.effectiveTenantId()!] : [nodeType];
    const rows = await this.adapter.query<any>(sql, params);
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

  /**
   * v2.2 P1 §1: SQL-pushdown 单键等值过滤。
   *
   * SQLite 路径:
   *   `WHERE nodeType=? AND json_extract(properties, '$.<key>') = ?`
   *   配合 `idx_nodes_<key>` 表达式索引(在 db.ts 里建)对热点 key 走索引。
   * Postgres 路径:
   *   `WHERE "nodeType"=? AND properties->>'<key>' = ?`
   *   走 `idx_nodes_properties_gin`(GIN on JSONB)。
   *
   * 等值语义与 `queryNodes(nt, {key: v})` 严格一致(JS `===`),便于渐进迁移。
   * 注意:value 是字符串等值;数字/bool 字段若以 JSON 数字存储仍需用 queryNodes(否则
   * `json_extract` 返回 number 与字符串 `?` 不等)。
   *
   * key 必须是 [A-Za-z0-9_一-鿿]+(防 JSON path 注入)。
   */
  async queryNodesByProperty(nodeType: string, key: string, value: string): Promise<GraphNode[]> {
    if (!/^[A-Za-z0-9_一-鿿]+$/.test(key)) {
      throw new Error(`queryNodesByProperty: invalid key ${JSON.stringify(key)}`);
    }
    const tenantClause = this.hasTenant() ? ` AND tenant_id = ?` : "";
    const tenantParams = this.tenantParam();
    let sql: string;
    if (this.adapter.kind === "postgres") {
      sql = `SELECT * FROM nodes WHERE "nodeType" = ? AND properties->>'${key}' = ?${tenantClause} ORDER BY created_at DESC`;
    } else {
      sql = `SELECT * FROM nodes WHERE "nodeType" = ? AND json_extract(properties, '$.${key}') = ?${tenantClause} ORDER BY created_at DESC`;
    }
    const rows = await this.adapter.query<any>(sql, [nodeType, value, ...tenantParams]);
    return rows.map((r) => ({
      id: r.id,
      nodeType: r.nodeType,
      properties: decodeJsonFromAdapter(this.adapter, r.properties),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
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
    const tid = this.effectiveTenantId() ?? "default";
    await this.adapter.transaction(async (tx) => {
      await tx.run(
        `INSERT INTO edges (id, "edgeType", "sourceId", "targetId", properties, tenant_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [e.id, edgeType, sourceId, targetId, encodeJsonForAdapter(tx, properties), tid, now, now]
      );
      await this.auditTx(tx, "CREATE", "edge", e.id, { edgeType, sourceId, targetId }, actor);
    });
    return e;
  }

  async queryEdges(opts: { sourceId?: string; targetId?: string; edgeType?: string }): Promise<GraphEdge[]> {
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
    if (this.hasTenant()) {
      wh.push(`tenant_id = ?`);
      params.push(this.effectiveTenantId()!);
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
    const selSql = this.hasTenant()
      ? `SELECT id, "edgeType", "sourceId", "targetId" FROM edges WHERE id = ? AND tenant_id = ?`
      : `SELECT id, "edgeType", "sourceId", "targetId" FROM edges WHERE id = ?`;
    const selParams = this.hasTenant() ? [id, this.effectiveTenantId()!] : [id];
    const row = await this.adapter.queryOne<{ id: string; edgeType: string; sourceId: string; targetId: string }>(
      selSql,
      selParams
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
    const id = randomUUID();
    const updatedAt = new Date().toISOString();
    const tid = this.effectiveTenantId() ?? "default";
    let seqNo = 0;
    const tenantFilter = this.hasTenant() ? ` AND tenant_id = ?` : "";
    const tenantParam = this.tenantParam();
    await this.adapter.transaction(async (tx) => {
      await tx.run(
        `INSERT INTO progress_log (id, "ownerId", "seqNo", content, "statusSnapshot", "updatedBy", "updatedAt", tenant_id)
         SELECT ?, ?, COALESCE(MAX("seqNo"), 0) + 1, ?, ?, ?, ?, ?
         FROM progress_log WHERE "ownerId" = ?${tenantFilter}`,
        [id, ownerId, content, statusSnapshot, actor, updatedAt, tid, ownerId, ...tenantParam]
      );
      const row = await tx.queryOne<{ seqNo: number }>(`SELECT "seqNo" FROM progress_log WHERE id = ?`, [id]);
      seqNo = row?.seqNo ?? 1;
      await this.auditTx(tx, "PROGRESS", "node", ownerId, { seqNo, content }, actor);
    });
    return {
      id,
      ownerId,
      seqNo,
      content,
      statusSnapshot,
      updatedBy: actor,
      updatedAt,
    };
  }

  async listProgress(ownerId: string): Promise<ProgressLog[]> {
    const sql = this.hasTenant()
      ? `SELECT * FROM progress_log WHERE "ownerId" = ? AND tenant_id = ? ORDER BY "seqNo"`
      : `SELECT * FROM progress_log WHERE "ownerId" = ? ORDER BY "seqNo"`;
    const params = this.hasTenant() ? [ownerId, this.effectiveTenantId()!] : [ownerId];
    const rows = await this.adapter.query<any>(sql, params);
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
    const sql = this.hasTenant()
      ? `SELECT * FROM progress_log WHERE tenant_id = ? ORDER BY "ownerId", "seqNo"`
      : `SELECT * FROM progress_log ORDER BY "ownerId", "seqNo"`;
    const params = this.tenantParam();
    const rows = await this.adapter.query<any>(sql, params);
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
    if (this.hasTenant()) {
      const rows = opts.status
        ? await this.adapter.query<any>(`SELECT * FROM proposals WHERE status = ? AND tenant_id = ?`, [
            opts.status,
            this.effectiveTenantId()!,
          ])
        : await this.adapter.query<any>(`SELECT * FROM proposals WHERE tenant_id = ?`, [this.effectiveTenantId()!]);
      return rows.map((r) => this.mapProposal(r));
    }
    const rows = opts.status
      ? await this.adapter.query<any>(`SELECT * FROM proposals WHERE status = ?`, [opts.status])
      : await this.adapter.query<any>(`SELECT * FROM proposals`);
    return rows.map((r) => this.mapProposal(r));
  }

  async getProposal(id: string): Promise<RelationProposal | undefined> {
    const sql = this.hasTenant()
      ? `SELECT * FROM proposals WHERE id = ? AND tenant_id = ?`
      : `SELECT * FROM proposals WHERE id = ?`;
    const params = this.hasTenant() ? [id, this.effectiveTenantId()!] : [id];
    const r = await this.adapter.queryOne<any>(sql, params);
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
    const whereSql = this.hasTenant() ? `WHERE id = ? AND tenant_id = ?` : `WHERE id = ?`;
    const whereParams = this.hasTenant() ? [id, this.effectiveTenantId()!] : [id];
    await this.adapter.transaction(async (tx) => {
      await tx.run(`UPDATE proposals SET status = ?, decided_by = ?, decided_at = ? ${whereSql}`, [
        status,
        decidedBy,
        at,
        ...whereParams,
      ]);
      await this.auditTx(tx, "UPDATE", "proposal", id, { status, decidedBy }, actor);
    });
    return { ...cur, status, decidedBy, decidedAt: at };
  }

  async deleteNode(id: string, actor: string): Promise<void> {
    await this.adapter.transaction(async (tx) => {
      const nodeTenant = this.hasTenant()
        ? await tx.queryOne<{ tenant_id: string | null }>(`SELECT tenant_id FROM nodes WHERE id = ?`, [id])
        : null;
      if (this.hasTenant() && !nodeTenant) return;
      const nodeTenantFilter = this.hasTenant() ? ` AND tenant_id = ?` : "";
      const nodeTenantParams = this.hasTenant() ? [this.effectiveTenantId()!] : [];
      await tx.run(`DELETE FROM progress_log WHERE "ownerId" = ?${nodeTenantFilter}`, [id, ...nodeTenantParams]);
      await tx.run(`DELETE FROM edges WHERE "sourceId" = ? OR "targetId" = ?`, [id, id]);
      await tx.run(`DELETE FROM ticket_tabs WHERE ticket_id = ?`, [id]);
      const result = await tx.run(`DELETE FROM nodes WHERE id = ?${nodeTenantFilter}`, [id, ...nodeTenantParams]);
      if (result.changes > 0) await this.auditTx(tx, "DELETE", "node", id, { id }, actor);
    });
  }

  async createReminder(
    p: Omit<Reminder, "id" | "status" | "decidedBy" | "decidedAt" | "createdAt">,
    actor: string
  ): Promise<Reminder> {
    const now = new Date().toISOString();
    const row: Reminder = { ...p, id: randomUUID(), status: "待发送", createdAt: now };
    const tid = this.effectiveTenantId() ?? "default";
    await this.adapter.transaction(async (tx) => {
      await tx.run(
        `INSERT INTO notifications (id, kind, ticket_id, recipient_person_id, recipient_name, subject, body, status, decided_by, decided_at, created_at, tenant_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          tid,
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
    if (this.hasTenant()) {
      const rows = opts.status
        ? await this.adapter.query<any>(
            `SELECT * FROM notifications WHERE status = ? AND tenant_id = ? ORDER BY created_at DESC`,
            [opts.status, this.effectiveTenantId()!]
          )
        : await this.adapter.query<any>(`SELECT * FROM notifications WHERE tenant_id = ? ORDER BY created_at DESC`, [
            this.effectiveTenantId()!,
          ]);
      return rows.map((r) => this.mapReminder(r));
    }
    const rows = opts.status
      ? await this.adapter.query<any>(`SELECT * FROM notifications WHERE status = ? ORDER BY created_at DESC`, [
          opts.status,
        ])
      : await this.adapter.query<any>(`SELECT * FROM notifications ORDER BY created_at DESC`);
    return rows.map((r) => this.mapReminder(r));
  }

  async getReminder(id: string): Promise<Reminder | undefined> {
    const sql = this.hasTenant()
      ? `SELECT * FROM notifications WHERE id = ? AND tenant_id = ?`
      : `SELECT * FROM notifications WHERE id = ?`;
    const params = this.hasTenant() ? [id, this.effectiveTenantId()!] : [id];
    const r = await this.adapter.queryOne<any>(sql, params);
    return r ? this.mapReminder(r) : undefined;
  }

  async updateReminderStatus(id: string, status: ReminderStatus, decidedBy: string, actor: string): Promise<Reminder> {
    const cur = await this.getReminder(id);
    if (!cur) throw new Error(`reminder ${id} not found`);
    const at = new Date().toISOString();
    const whereSql = this.hasTenant() ? `WHERE id = ? AND tenant_id = ?` : `WHERE id = ?`;
    const whereParams = this.hasTenant() ? [id, this.effectiveTenantId()!] : [id];
    await this.adapter.transaction(async (tx) => {
      await tx.run(`UPDATE notifications SET status = ?, decided_by = ?, decided_at = ? ${whereSql}`, [
        status,
        decidedBy,
        at,
        ...whereParams,
      ]);
      await this.auditTx(tx, "UPDATE", "reminder", id, { status, decidedBy }, actor);
    });
    return { ...cur, status, decidedBy, decidedAt: at };
  }
}
