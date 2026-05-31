import { randomUUID } from "node:crypto";
import type { DbAdapter } from "./db-adapter.js";
import { log } from "./logger.js";

export interface WebhookSubscription {
  id: string;
  url: string;
  secret: string;
  events: string[];
  enabled: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type WebhookEvent =
  | "node.created"
  | "node.updated"
  | "node.deleted"
  | "node.transition"
  | "progress.added"
  | "help_request.created"
  | "bug_report.created"
  | "reminder.sent"
  | "escalation.triggered"
  | "user.created"
  | "system.upgrade";

const ALL_EVENTS: WebhookEvent[] = [
  "node.created",
  "node.updated",
  "node.deleted",
  "node.transition",
  "progress.added",
  "help_request.created",
  "bug_report.created",
  "reminder.sent",
  "escalation.triggered",
  "user.created",
  "system.upgrade",
];

export { ALL_EVENTS };

function toSub(r: any): WebhookSubscription {
  return {
    id: r.id,
    url: r.url,
    secret: r.secret,
    events: JSON.parse(r.events || "[]"),
    enabled: !!r.enabled,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function ensureWebhooksTable(adapter: DbAdapter): Promise<void> {
  if (adapter.kind === "sqlite") {
    adapter.rawSqlite().exec(`
      CREATE TABLE IF NOT EXISTS webhook_subscriptions (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        secret TEXT NOT NULL,
        events TEXT NOT NULL DEFAULT '[]',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_by TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }
}

export class WebhooksRepo {
  constructor(private adapter: DbAdapter) {}

  async list(): Promise<WebhookSubscription[]> {
    const rows = await this.adapter.query<any>("SELECT * FROM webhook_subscriptions ORDER BY created_at DESC");
    return rows.map(toSub);
  }

  async get(id: string): Promise<WebhookSubscription | null> {
    const row = await this.adapter.queryOne<any>("SELECT * FROM webhook_subscriptions WHERE id = ?", [id]);
    return row ? toSub(row) : null;
  }

  async create(input: { url: string; events: string[]; createdBy: string }): Promise<WebhookSubscription> {
    const id = randomUUID();
    const secret = randomUUID();
    const now = new Date().toISOString();
    await this.adapter.run(
      `INSERT INTO webhook_subscriptions (id, url, secret, events, enabled, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
      [id, input.url, secret, JSON.stringify(input.events), input.createdBy, now, now]
    );
    log.info("webhook.create", { id, url: input.url, events: input.events });
    return (await this.get(id))!;
  }

  async update(
    id: string,
    input: { url?: string; events?: string[]; enabled?: boolean }
  ): Promise<WebhookSubscription | null> {
    const existing = await this.get(id);
    if (!existing) return null;
    const now = new Date().toISOString();
    const url = input.url ?? existing.url;
    const events = input.events ?? existing.events;
    const enabled = input.enabled ?? existing.enabled;
    await this.adapter.run(
      "UPDATE webhook_subscriptions SET url = ?, events = ?, enabled = ?, updated_at = ? WHERE id = ?",
      [url, JSON.stringify(events), enabled ? 1 : 0, now, id]
    );
    log.info("webhook.update", { id });
    return (await this.get(id))!;
  }

  async delete(id: string): Promise<boolean> {
    const r = await this.adapter.run("DELETE FROM webhook_subscriptions WHERE id = ?", [id]);
    if (r.changes && r.changes > 0) {
      log.info("webhook.delete", { id });
      return true;
    }
    return false;
  }

  async getActiveForEvent(event: string): Promise<WebhookSubscription[]> {
    const all = await this.list();
    return all.filter((s) => s.enabled && s.events.includes(event));
  }
}

export interface WebhookPayload {
  event: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export async function dispatchWebhook(adapter: DbAdapter, event: string, data: Record<string, unknown>): Promise<void> {
  const repo = new WebhooksRepo(adapter);
  const subs = await repo.getActiveForEvent(event);
  if (subs.length === 0) return;

  const payload: WebhookPayload = {
    event,
    timestamp: new Date().toISOString(),
    data,
  };

  for (const sub of subs) {
    dispatchOne(sub, payload).catch((e) =>
      log.warn("webhook.dispatch_fail", { id: sub.id, url: sub.url, error: (e as Error).message })
    );
  }
}

export async function dispatchOne(sub: WebhookSubscription, payload: WebhookPayload): Promise<void> {
  const body = JSON.stringify(payload);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(sub.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": sub.secret,
        "X-Webhook-Event": payload.event,
      },
      body,
      signal: controller.signal,
    });
    log.info("webhook.dispatch", { id: sub.id, url: sub.url, event: payload.event, status: res.status });
  } finally {
    clearTimeout(timer);
  }
}
