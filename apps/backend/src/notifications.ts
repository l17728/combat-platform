import { randomUUID } from "node:crypto";
import type { DbAdapter } from "./db-adapter.js";
import { log } from "./logger.js";

export type NotificationKind = "escalation" | "reminder" | "mention" | "help_request" | "bug_update" | "system";

export interface InboxNotification {
  id: string;
  userId: string;
  kind: NotificationKind | string;
  title: string;
  body: string | null;
  link: string | null;
  sourceEntityId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface CreateNotificationInput {
  userId: string;
  kind: NotificationKind | string;
  title: string;
  body?: string | null;
  link?: string | null;
  sourceEntityId?: string | null;
}

function toNotification(r: any): InboxNotification {
  return {
    id: r.id,
    userId: r.user_id,
    kind: r.kind,
    title: r.title,
    body: r.body ?? null,
    link: r.link ?? null,
    sourceEntityId: r.source_entity_id ?? null,
    readAt: r.read_at ?? null,
    createdAt: r.created_at,
  };
}

/**
 * In-process pub/sub for SSE. createNotification 写 DB 后 fanout 到所有订阅者;
 * 订阅者按 userId 过滤。仅单进程内有效,集群场景应换 Redis pub/sub。
 */
type Subscriber = (n: InboxNotification) => void;
const SUBSCRIBERS = new Set<Subscriber>();

export function subscribeNotifications(fn: Subscriber): () => void {
  SUBSCRIBERS.add(fn);
  return () => SUBSCRIBERS.delete(fn);
}

function publish(n: InboxNotification): void {
  for (const fn of SUBSCRIBERS) {
    try {
      fn(n);
    } catch (e) {
      log.warn("notifications.publish_fail", { error: (e as Error).message });
    }
  }
}

export class NotificationsRepo {
  constructor(private adapter: DbAdapter) {}

  async create(input: CreateNotificationInput): Promise<InboxNotification> {
    const id = randomUUID();
    const now = new Date().toISOString();
    await this.adapter.run(
      `INSERT INTO inbox_notifications (id, user_id, kind, title, body, link, source_entity_id, read_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      [
        id,
        input.userId,
        input.kind,
        input.title,
        input.body ?? null,
        input.link ?? null,
        input.sourceEntityId ?? null,
        now,
      ]
    );
    const row = await this.adapter.queryOne<any>("SELECT * FROM inbox_notifications WHERE id = ?", [id]);
    const n = toNotification(row);
    log.info("notification.create", { id, userId: input.userId, kind: input.kind });
    publish(n);
    return n;
  }

  async list(userId: string, opts: { unread?: boolean; limit?: number } = {}): Promise<InboxNotification[]> {
    const limit = Math.max(1, Math.min(200, opts.limit ?? 50));
    const sql = opts.unread
      ? "SELECT * FROM inbox_notifications WHERE user_id = ? AND read_at IS NULL ORDER BY created_at DESC LIMIT ?"
      : "SELECT * FROM inbox_notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?";
    const rows = await this.adapter.query<any>(sql, [userId, limit]);
    return rows.map(toNotification);
  }

  async unreadCount(userId: string): Promise<number> {
    const row = await this.adapter.queryOne<{ c: number }>(
      "SELECT COUNT(*) as c FROM inbox_notifications WHERE user_id = ? AND read_at IS NULL",
      [userId]
    );
    return Number(row?.c ?? 0);
  }

  async markRead(userId: string, id: string): Promise<InboxNotification | null> {
    const existing = await this.adapter.queryOne<any>(
      "SELECT * FROM inbox_notifications WHERE id = ? AND user_id = ?",
      [id, userId]
    );
    if (!existing) return null;
    if (!existing.read_at) {
      await this.adapter.run("UPDATE inbox_notifications SET read_at = ? WHERE id = ? AND user_id = ?", [
        new Date().toISOString(),
        id,
        userId,
      ]);
    }
    const row = await this.adapter.queryOne<any>("SELECT * FROM inbox_notifications WHERE id = ?", [id]);
    return toNotification(row);
  }

  async markAllRead(userId: string): Promise<number> {
    const now = new Date().toISOString();
    const r = await this.adapter.run(
      "UPDATE inbox_notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL",
      [now, userId]
    );
    return r.changes ?? 0;
  }
}

/**
 * Convenience helper used by trigger sites (escalation/reminders/help/bug-report).
 * 失败仅记 warn,不抛 — 通知是辅助信号,不应让主流程挂掉。
 */
export async function createNotificationSafe(
  repo: NotificationsRepo,
  input: CreateNotificationInput
): Promise<InboxNotification | null> {
  try {
    return await repo.create(input);
  } catch (e) {
    log.warn("notification.create_fail", { error: (e as Error).message, kind: input.kind, userId: input.userId });
    return null;
  }
}
