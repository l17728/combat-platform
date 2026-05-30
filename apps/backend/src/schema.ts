// schema-as-code for both SQLite and Postgres backends.
// Phase 1: tables and indexes mirror the inline CREATE TABLE statements in db.ts.
// `properties` columns remain TEXT (JSON-as-string) for both backends to keep
// Phase 1 a pure schema translation. Phase 4 may migrate Postgres to JSONB.

import {
  sqliteTable,
  text as sqliteText,
  integer as sqliteInteger,
  real as sqliteReal,
  index as sqliteIndex,
} from "drizzle-orm/sqlite-core";
import {
  pgTable,
  text as pgText,
  integer as pgInteger,
  doublePrecision as pgDouble,
  index as pgIndex,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// SQLite schema
// ---------------------------------------------------------------------------

export const sqliteSchema = {
  nodes: sqliteTable(
    "nodes",
    {
      id: sqliteText("id").primaryKey(),
      nodeType: sqliteText("nodeType").notNull(),
      properties: sqliteText("properties").notNull(),
      searchText: sqliteText("search_text"),
      createdAt: sqliteText("created_at"),
      updatedAt: sqliteText("updated_at"),
    },
    (t) => ({
      typeIdx: sqliteIndex("idx_nodes_type").on(t.nodeType),
    }),
  ),

  edges: sqliteTable(
    "edges",
    {
      id: sqliteText("id").primaryKey(),
      edgeType: sqliteText("edgeType").notNull(),
      sourceId: sqliteText("sourceId").notNull(),
      targetId: sqliteText("targetId").notNull(),
      properties: sqliteText("properties").notNull(),
      createdAt: sqliteText("created_at"),
      updatedAt: sqliteText("updated_at"),
    },
    (t) => ({
      sourceIdx: sqliteIndex("idx_edges_source").on(t.sourceId),
      targetIdx: sqliteIndex("idx_edges_target").on(t.targetId),
      typeIdx: sqliteIndex("idx_edges_type").on(t.edgeType),
    }),
  ),

  progressLog: sqliteTable(
    "progress_log",
    {
      id: sqliteText("id").primaryKey(),
      ownerId: sqliteText("ownerId").notNull(),
      seqNo: sqliteInteger("seqNo").notNull(),
      content: sqliteText("content").notNull(),
      statusSnapshot: sqliteText("statusSnapshot"),
      updatedBy: sqliteText("updatedBy"),
      updatedAt: sqliteText("updatedAt"),
    },
    (t) => ({
      ownerIdx: sqliteIndex("idx_progress_owner").on(t.ownerId, t.seqNo),
    }),
  ),

  auditLog: sqliteTable("audit_log", {
    id: sqliteText("id").primaryKey(),
    action: sqliteText("action").notNull(),
    entityType: sqliteText("entityType"),
    entityId: sqliteText("entityId"),
    changes: sqliteText("changes"),
    performedBy: sqliteText("performedBy"),
    performedAt: sqliteText("performedAt"),
  }),

  proposals: sqliteTable(
    "proposals",
    {
      id: sqliteText("id").primaryKey(),
      sourceNodeId: sqliteText("source_node_id").notNull(),
      targetNodeId: sqliteText("target_node_id").notNull(),
      relationType: sqliteText("relation_type").notNull(),
      confidence: sqliteReal("confidence"),
      proposerSource: sqliteText("proposer_source"),
      rationale: sqliteText("rationale"),
      status: sqliteText("status").notNull(),
      decidedBy: sqliteText("decided_by"),
      decidedAt: sqliteText("decided_at"),
      createdAt: sqliteText("created_at"),
    },
    (t) => ({
      statusIdx: sqliteIndex("idx_proposals_status").on(t.status),
    }),
  ),

  notifications: sqliteTable(
    "notifications",
    {
      id: sqliteText("id").primaryKey(),
      kind: sqliteText("kind").notNull(),
      ticketId: sqliteText("ticket_id").notNull(),
      recipientPersonId: sqliteText("recipient_person_id"),
      recipientName: sqliteText("recipient_name"),
      subject: sqliteText("subject"),
      body: sqliteText("body"),
      status: sqliteText("status").notNull(),
      decidedBy: sqliteText("decided_by"),
      decidedAt: sqliteText("decided_at"),
      createdAt: sqliteText("created_at"),
    },
    (t) => ({
      statusIdx: sqliteIndex("idx_notifications_status").on(t.status),
    }),
  ),

  appSettings: sqliteTable("app_settings", {
    key: sqliteText("key").primaryKey(),
    value: sqliteText("value"),
  }),

  dailyReportEntry: sqliteTable(
    "daily_report_entry",
    {
      id: sqliteText("id").primaryKey(),
      ticketId: sqliteText("ticket_id").notNull(),
      type: sqliteText("type").notNull().default("进展通报"),
      currentProgress: sqliteText("current_progress").notNull().default(""),
      nextSteps: sqliteText("next_steps").notNull().default(""),
      status: sqliteText("status").notNull().default("草稿"),
      createdBy: sqliteText("created_by").notNull().default(""),
      createdAt: sqliteText("created_at").notNull(),
      publishedAt: sqliteText("published_at"),
    },
    (t) => ({
      ticketIdx: sqliteIndex("idx_dre_ticket").on(t.ticketId),
    }),
  ),

  supportTemplate: sqliteTable("support_template", {
    id: sqliteText("id").primaryKey(),
    name: sqliteText("name").notNull(),
    description: sqliteText("description").notNull().default(""),
    usageCount: sqliteInteger("usage_count").notNull().default(0),
    createdAt: sqliteText("created_at").notNull(),
  }),

  supportNode: sqliteTable(
    "support_node",
    {
      id: sqliteText("id").primaryKey(),
      ticketId: sqliteText("ticket_id"),
      templateId: sqliteText("template_id"),
      parentId: sqliteText("parent_id"),
      category: sqliteText("category").notNull(),
      domain: sqliteText("domain").notNull(),
      personId: sqliteText("person_id"),
      personName: sqliteText("person_name"),
      status: sqliteText("status").notNull().default("待确认"),
      note: sqliteText("note").notNull().default(""),
      createdAt: sqliteText("created_at").notNull(),
      resolvedAt: sqliteText("resolved_at"),
    },
    (t) => ({
      ticketIdx: sqliteIndex("idx_support_node_ticket").on(t.ticketId),
      templateIdx: sqliteIndex("idx_support_node_template").on(t.templateId),
    }),
  ),

  users: sqliteTable(
    "users",
    {
      id: sqliteText("id").primaryKey(),
      username: sqliteText("username").notNull().unique(),
      passwordHash: sqliteText("password_hash").notNull(),
      role: sqliteText("role").notNull().default("normal"),
      displayName: sqliteText("display_name").notNull().default(""),
      createdAt: sqliteText("created_at").notNull(),
      updatedAt: sqliteText("updated_at").notNull(),
    },
    (t) => ({
      usernameIdx: sqliteIndex("idx_users_username").on(t.username),
    }),
  ),

  ticketTabs: sqliteTable(
    "ticket_tabs",
    {
      id: sqliteText("id").primaryKey(),
      ticketId: sqliteText("ticket_id").notNull(),
      tabType: sqliteText("tab_type").notNull(),
      title: sqliteText("title").notNull(),
      tabOrder: sqliteInteger("tab_order").notNull().default(0),
      config: sqliteText("config").notNull().default("{}"),
      content: sqliteText("content").notNull().default(""),
      createdBy: sqliteText("created_by").notNull().default(""),
      createdAt: sqliteText("created_at").notNull(),
      updatedAt: sqliteText("updated_at").notNull(),
    },
    (t) => ({
      ticketIdx: sqliteIndex("idx_ticket_tabs_ticket").on(t.ticketId),
    }),
  ),
};

// ---------------------------------------------------------------------------
// Postgres schema
// ---------------------------------------------------------------------------

export const postgresSchema = {
  nodes: pgTable(
    "nodes",
    {
      id: pgText("id").primaryKey(),
      nodeType: pgText("nodeType").notNull(),
      properties: pgText("properties").notNull(),
      searchText: pgText("search_text"),
      createdAt: pgText("created_at"),
      updatedAt: pgText("updated_at"),
    },
    (t) => ({
      typeIdx: pgIndex("idx_nodes_type").on(t.nodeType),
    }),
  ),

  edges: pgTable(
    "edges",
    {
      id: pgText("id").primaryKey(),
      edgeType: pgText("edgeType").notNull(),
      sourceId: pgText("sourceId").notNull(),
      targetId: pgText("targetId").notNull(),
      properties: pgText("properties").notNull(),
      createdAt: pgText("created_at"),
      updatedAt: pgText("updated_at"),
    },
    (t) => ({
      sourceIdx: pgIndex("idx_edges_source").on(t.sourceId),
      targetIdx: pgIndex("idx_edges_target").on(t.targetId),
      typeIdx: pgIndex("idx_edges_type").on(t.edgeType),
    }),
  ),

  progressLog: pgTable(
    "progress_log",
    {
      id: pgText("id").primaryKey(),
      ownerId: pgText("ownerId").notNull(),
      seqNo: pgInteger("seqNo").notNull(),
      content: pgText("content").notNull(),
      statusSnapshot: pgText("statusSnapshot"),
      updatedBy: pgText("updatedBy"),
      updatedAt: pgText("updatedAt"),
    },
    (t) => ({
      ownerIdx: pgIndex("idx_progress_owner").on(t.ownerId, t.seqNo),
    }),
  ),

  auditLog: pgTable("audit_log", {
    id: pgText("id").primaryKey(),
    action: pgText("action").notNull(),
    entityType: pgText("entityType"),
    entityId: pgText("entityId"),
    changes: pgText("changes"),
    performedBy: pgText("performedBy"),
    performedAt: pgText("performedAt"),
  }),

  proposals: pgTable(
    "proposals",
    {
      id: pgText("id").primaryKey(),
      sourceNodeId: pgText("source_node_id").notNull(),
      targetNodeId: pgText("target_node_id").notNull(),
      relationType: pgText("relation_type").notNull(),
      confidence: pgDouble("confidence"),
      proposerSource: pgText("proposer_source"),
      rationale: pgText("rationale"),
      status: pgText("status").notNull(),
      decidedBy: pgText("decided_by"),
      decidedAt: pgText("decided_at"),
      createdAt: pgText("created_at"),
    },
    (t) => ({
      statusIdx: pgIndex("idx_proposals_status").on(t.status),
    }),
  ),

  notifications: pgTable(
    "notifications",
    {
      id: pgText("id").primaryKey(),
      kind: pgText("kind").notNull(),
      ticketId: pgText("ticket_id").notNull(),
      recipientPersonId: pgText("recipient_person_id"),
      recipientName: pgText("recipient_name"),
      subject: pgText("subject"),
      body: pgText("body"),
      status: pgText("status").notNull(),
      decidedBy: pgText("decided_by"),
      decidedAt: pgText("decided_at"),
      createdAt: pgText("created_at"),
    },
    (t) => ({
      statusIdx: pgIndex("idx_notifications_status").on(t.status),
    }),
  ),

  appSettings: pgTable("app_settings", {
    key: pgText("key").primaryKey(),
    value: pgText("value"),
  }),

  dailyReportEntry: pgTable(
    "daily_report_entry",
    {
      id: pgText("id").primaryKey(),
      ticketId: pgText("ticket_id").notNull(),
      type: pgText("type").notNull().default("进展通报"),
      currentProgress: pgText("current_progress").notNull().default(""),
      nextSteps: pgText("next_steps").notNull().default(""),
      status: pgText("status").notNull().default("草稿"),
      createdBy: pgText("created_by").notNull().default(""),
      createdAt: pgText("created_at").notNull(),
      publishedAt: pgText("published_at"),
    },
    (t) => ({
      ticketIdx: pgIndex("idx_dre_ticket").on(t.ticketId),
    }),
  ),

  supportTemplate: pgTable("support_template", {
    id: pgText("id").primaryKey(),
    name: pgText("name").notNull(),
    description: pgText("description").notNull().default(""),
    usageCount: pgInteger("usage_count").notNull().default(0),
    createdAt: pgText("created_at").notNull(),
  }),

  supportNode: pgTable(
    "support_node",
    {
      id: pgText("id").primaryKey(),
      ticketId: pgText("ticket_id"),
      templateId: pgText("template_id"),
      parentId: pgText("parent_id"),
      category: pgText("category").notNull(),
      domain: pgText("domain").notNull(),
      personId: pgText("person_id"),
      personName: pgText("person_name"),
      status: pgText("status").notNull().default("待确认"),
      note: pgText("note").notNull().default(""),
      createdAt: pgText("created_at").notNull(),
      resolvedAt: pgText("resolved_at"),
    },
    (t) => ({
      ticketIdx: pgIndex("idx_support_node_ticket").on(t.ticketId),
      templateIdx: pgIndex("idx_support_node_template").on(t.templateId),
    }),
  ),

  users: pgTable(
    "users",
    {
      id: pgText("id").primaryKey(),
      username: pgText("username").notNull().unique(),
      passwordHash: pgText("password_hash").notNull(),
      role: pgText("role").notNull().default("normal"),
      displayName: pgText("display_name").notNull().default(""),
      createdAt: pgText("created_at").notNull(),
      updatedAt: pgText("updated_at").notNull(),
    },
    (t) => ({
      usernameIdx: pgIndex("idx_users_username").on(t.username),
    }),
  ),

  ticketTabs: pgTable(
    "ticket_tabs",
    {
      id: pgText("id").primaryKey(),
      ticketId: pgText("ticket_id").notNull(),
      tabType: pgText("tab_type").notNull(),
      title: pgText("title").notNull(),
      tabOrder: pgInteger("tab_order").notNull().default(0),
      config: pgText("config").notNull().default("{}"),
      content: pgText("content").notNull().default(""),
      createdBy: pgText("created_by").notNull().default(""),
      createdAt: pgText("created_at").notNull(),
      updatedAt: pgText("updated_at").notNull(),
    },
    (t) => ({
      ticketIdx: pgIndex("idx_ticket_tabs_ticket").on(t.ticketId),
    }),
  ),
};

export type SqliteSchema = typeof sqliteSchema;
export type PostgresSchema = typeof postgresSchema;
