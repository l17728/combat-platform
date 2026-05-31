import type { DbAdapter } from "./db-adapter.js";
import type { Repository } from "@combat/shared";
import type { MailSender } from "./mailer.js";
import type { SmtpConfig } from "@combat/shared";
import { log } from "./logger.js";
import { encrypt, decrypt, isEncrypted } from "./crypto.js";

export interface DigestConfig {
  id: string;
  enabled: boolean;
  frequency: "daily" | "weekly";
  recipients: string[];
  includeStats: boolean;
  includeNewTickets: boolean;
  includeTransitions: boolean;
  includeContributions: boolean;
  lastSentAt: string | null;
  updatedAt: string;
}

function toConfig(r: any): DigestConfig {
  return {
    id: r.id,
    enabled: !!r.enabled,
    frequency: r.frequency,
    recipients: JSON.parse(r.recipients || "[]"),
    includeStats: !!r.include_stats,
    includeNewTickets: !!r.include_new_tickets,
    includeTransitions: !!r.include_transitions,
    includeContributions: !!r.include_contributions,
    lastSentAt: r.last_sent_at,
    updatedAt: r.updated_at,
  };
}

export async function ensureDigestTable(adapter: DbAdapter): Promise<void> {
  if (adapter.kind === "sqlite") {
    adapter.rawSqlite().exec(`
      CREATE TABLE IF NOT EXISTS digest_config (
        id TEXT PRIMARY KEY DEFAULT 'default',
        enabled INTEGER NOT NULL DEFAULT 0,
        frequency TEXT NOT NULL DEFAULT 'daily',
        recipients TEXT NOT NULL DEFAULT '[]',
        include_stats INTEGER NOT NULL DEFAULT 1,
        include_new_tickets INTEGER NOT NULL DEFAULT 1,
        include_transitions INTEGER NOT NULL DEFAULT 1,
        include_contributions INTEGER NOT NULL DEFAULT 1,
        last_sent_at TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }
}

export class DigestRepo {
  constructor(private adapter: DbAdapter) {}

  async getConfig(): Promise<DigestConfig> {
    const row = await this.adapter.queryOne<any>("SELECT * FROM digest_config WHERE id = 'default'");
    if (!row) {
      return {
        id: "default",
        enabled: false,
        frequency: "daily",
        recipients: [],
        includeStats: true,
        includeNewTickets: true,
        includeTransitions: true,
        includeContributions: true,
        lastSentAt: null,
        updatedAt: new Date().toISOString(),
      };
    }
    return toConfig(row);
  }

  async updateConfig(input: Partial<Omit<DigestConfig, "id">>): Promise<DigestConfig> {
    const existing = await this.getConfig();
    const now = new Date().toISOString();
    const enabled = (input.enabled ?? existing.enabled) ? 1 : 0;
    const recipients = JSON.stringify(input.recipients ?? existing.recipients);
    const includeStats = (input.includeStats ?? existing.includeStats) ? 1 : 0;
    const includeNewTickets = (input.includeNewTickets ?? existing.includeNewTickets) ? 1 : 0;
    const includeTransitions = (input.includeTransitions ?? existing.includeTransitions) ? 1 : 0;
    const includeContributions = (input.includeContributions ?? existing.includeContributions) ? 1 : 0;

    if (
      existing.id === "default" &&
      !(await this.adapter.queryOne("SELECT 1 FROM digest_config WHERE id = 'default'"))
    ) {
      await this.adapter.run(
        `INSERT INTO digest_config (id, enabled, frequency, recipients, include_stats, include_new_tickets, include_transitions, include_contributions, updated_at)
         VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          enabled,
          input.frequency ?? existing.frequency,
          recipients,
          includeStats,
          includeNewTickets,
          includeTransitions,
          includeContributions,
          now,
        ]
      );
    } else {
      await this.adapter.run(
        `UPDATE digest_config SET enabled=?, frequency=?, recipients=?, include_stats=?, include_new_tickets=?, include_transitions=?, include_contributions=?, updated_at=?
         WHERE id='default'`,
        [
          enabled,
          input.frequency ?? existing.frequency,
          recipients,
          includeStats,
          includeNewTickets,
          includeTransitions,
          includeContributions,
          now,
        ]
      );
    }
    log.info("digest.config_updated", { enabled: !!enabled, frequency: input.frequency ?? existing.frequency });
    return this.getConfig();
  }

  async markSent(): Promise<void> {
    const now = new Date().toISOString();
    await this.adapter.run("UPDATE digest_config SET last_sent_at = ? WHERE id = 'default'", [now]);
  }
}

export interface DigestSummary {
  newTickets: { id: string; title: string; status: string }[];
  transitions: { id: string; title: string; from: string; to: string; time: string }[];
  newContributions: { id: string; person: string; type: string; level: string }[];
  stats: { totalTickets: number; openTickets: number; resolvedToday: number; totalContributions: number };
}

export async function buildDigestSummary(repo: Repository, since: Date): Promise<DigestSummary> {
  const allTickets = await repo.queryNodes("attackTicket");
  const allContributions = await repo.queryNodes("contribution");

  const recentTickets = allTickets.filter((t) => new Date(t.createdAt) >= since);
  const newTickets = recentTickets.map((t) => ({
    id: t.id,
    title: String(t.properties["标题"] ?? ""),
    status: String(t.properties["状态"] ?? ""),
  }));

  const sinceStr = since.toISOString();
  const progressLists = await Promise.all(
    allTickets.slice(0, 200).map(async (t) => {
      const prog = await repo.listProgress(t.id);
      return prog
        .filter((p) => p.content?.includes("状态变更") && new Date(p.updatedAt) >= since)
        .map((p) => {
          const m = p.content.match(/状态变更：(.+?)→(.+)/);
          return {
            id: t.id,
            title: String(t.properties["标题"] ?? ""),
            from: m?.[1] || "",
            to: m?.[2] || "",
            time: new Date(p.updatedAt).toLocaleString("zh-CN"),
          };
        });
    })
  );
  const transitions = progressLists.flat();

  const recentContribs = allContributions.filter((c) => new Date(c.createdAt) >= since);
  const newContributions = recentContribs.map((c) => ({
    id: c.id,
    person: String(c.properties["贡献人"] ?? ""),
    type: String(c.properties["贡献类型"] ?? ""),
    level: String(c.properties["贡献等级"] ?? ""),
  }));

  const resolvedToday = allTickets.filter(
    (t) => String(t.properties["状态"]) === "已解决" && new Date(t.updatedAt) >= since
  ).length;

  return {
    newTickets,
    transitions,
    newContributions,
    stats: {
      totalTickets: allTickets.length,
      openTickets: allTickets.filter((t) => !["已关闭", "已解决"].includes(String(t.properties["状态"]))).length,
      resolvedToday,
      totalContributions: allContributions.length,
    },
  };
}

function formatDigestEmail(config: DigestConfig, summary: DigestSummary, since: Date): string {
  const lines: string[] = [];
  const period = config.frequency === "daily" ? "日报" : "周报";
  const dateRange = `${since.toLocaleDateString("zh-CN")} ~ ${new Date().toLocaleDateString("zh-CN")}`;

  lines.push(`=== 作战管理平台 ${period} ===`);
  lines.push(`期间：${dateRange}`);
  lines.push("");

  if (config.includeStats) {
    lines.push("--- 总体统计 ---");
    lines.push(`攻关单总数：${summary.stats.totalTickets}`);
    lines.push(`进行中：${summary.stats.openTickets}`);
    lines.push(`已解决：${summary.stats.resolvedToday}`);
    lines.push(`贡献总数：${summary.stats.totalContributions}`);
    lines.push("");
  }

  if (config.includeNewTickets && summary.newTickets.length > 0) {
    lines.push("--- 新建攻关单 ---");
    for (const t of summary.newTickets) {
      lines.push(`• ${t.title} [${t.status}]`);
    }
    lines.push("");
  }

  if (config.includeTransitions && summary.transitions.length > 0) {
    lines.push("--- 状态流转 ---");
    for (const t of summary.transitions) {
      lines.push(`• ${t.title}: ${t.from} → ${t.to} (${t.time})`);
    }
    lines.push("");
  }

  if (config.includeContributions && summary.newContributions.length > 0) {
    lines.push("--- 新增贡献 ---");
    for (const c of summary.newContributions) {
      lines.push(`• ${c.person} - ${c.type} [${c.level}]`);
    }
    lines.push("");
  }

  if (summary.newTickets.length === 0 && summary.transitions.length === 0 && summary.newContributions.length === 0) {
    lines.push("本期无新动态。");
  }

  lines.push("---");
  lines.push("此邮件由系统自动发送，请勿直接回复。");
  return lines.join("\n");
}

export async function sendDigest(
  adapter: DbAdapter,
  repo: Repository,
  mailSender: MailSender,
  smtpConfig: SmtpConfig
): Promise<{ sent: boolean; error?: string }> {
  const digestRepo = new DigestRepo(adapter);
  const config = await digestRepo.getConfig();

  if (!config.enabled || config.recipients.length === 0) {
    return { sent: false, error: "未启用或无收件人" };
  }

  const since =
    config.frequency === "daily"
      ? new Date(Date.now() - 24 * 60 * 60 * 1000)
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const summary = await buildDigestSummary(repo, since);
  const body = formatDigestEmail(config, summary, since);
  const period = config.frequency === "daily" ? "日报" : "周报";
  const subject = `【作战管理平台】${period} ${new Date().toLocaleDateString("zh-CN")}`;

  try {
    await mailSender.send(smtpConfig, { to: config.recipients, subject, body });
    await digestRepo.markSent();
    log.info("digest.sent", { recipients: config.recipients.length, frequency: config.frequency });
    return { sent: true };
  } catch (e: any) {
    log.warn("digest.send_fail", { error: e.message });
    return { sent: false, error: e.message };
  }
}
