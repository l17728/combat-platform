import type { Repository, SchemaRegistry, ReminderKind } from "@combat/shared";

const STALE_DAYS = 3;
const DEADLINE_WARN_DAYS = 3;
const OPEN = new Set(["待响应", "处理中", "进行中"]);

export interface ReminderDraft {
  kind: ReminderKind; ticketId: string;
  recipientPersonId?: string; recipientName: string;
  subject: string; body: string;
}

function currentHandler(repo: Repository, ticketId: string): { id: string; name: string } | undefined {
  const e = repo.queryEdges({ sourceId: ticketId, edgeType: "REF" })
    .find(e => String(e.properties["field"] ?? "") === "当前处理人");
  if (!e) return undefined;
  const p = repo.getNode(e.targetId);
  if (!p) return undefined;
  return { id: p.id, name: String(p.properties["name"] ?? p.id) };
}

export function scanReminders(repo: Repository, _registry: SchemaRegistry, nowMs: number = Date.now()): ReminderDraft[] {
  const drafts: ReminderDraft[] = [];
  for (const t of repo.queryNodes("attackTicket")) {
    const status = String(t.properties["状态"] ?? "").trim();
    if (!OPEN.has(status)) continue;
    const handler = currentHandler(repo, t.id);
    if (!handler) continue;
    const title = String(t.properties["标题"] ?? t.id);

    const progresses = repo.listProgress(t.id);
    const lastAt = progresses.length
      ? progresses[progresses.length - 1].updatedAt
      : t.updatedAt;
    const lastMs = Date.parse(lastAt);
    if (Number.isFinite(lastMs) && (nowMs - lastMs) >= STALE_DAYS * 86400000) {
      const days = Math.floor((nowMs - lastMs) / 86400000);
      drafts.push({
        kind: "问题单跟催", ticketId: t.id,
        recipientPersonId: handler.id, recipientName: handler.name,
        subject: `[跟催] 攻关单「${title}」已停滞 ${days} 天`,
        body: `攻关单「${title}」（${t.properties["攻关单号"] ?? t.id}）状态「${status}」自 ${lastAt} 起停滞 ${days} 天，请关注。`,
      });
    }

    // ② CCB 提醒 (李嘉②): ticket flagged 是否需CCB=是 + status open + handler exists
    if (String(t.properties["是否需CCB"] ?? "").trim() === "是") {
      drafts.push({
        kind: "CCB 提醒", ticketId: t.id,
        recipientPersonId: handler.id, recipientName: handler.name,
        subject: `[CCB] 攻关单「${title}」需上 CCB 评审`,
        body: `攻关单「${title}」（${t.properties["攻关单号"] ?? t.id}）状态「${status}」标记为需要 CCB 评审，请安排上会。`,
      });
    }

    const dl = String(t.properties["客户要求解决时间"] ?? "").trim();
    if (dl) {
      const dlMs = Date.parse(dl);
      if (Number.isFinite(dlMs)) {
        const delta = dlMs - nowMs;
        if (delta >= 0 && delta <= DEADLINE_WARN_DAYS * 86400000) {
          const left = Math.ceil(delta / 86400000);
          drafts.push({
            kind: "FE Deadline 提醒", ticketId: t.id,
            recipientPersonId: handler.id, recipientName: handler.name,
            subject: `[Deadline] 攻关单「${title}」客户期限 ${left} 天内`,
            body: `攻关单「${title}」状态「${status}」客户要求解决时间 ${dl}，剩余约 ${left} 天，请尽快推进。`,
          });
        }
      }
    }
  }
  return drafts;
}
