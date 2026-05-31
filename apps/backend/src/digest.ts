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

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildDigestHtml(config: DigestConfig, summary: DigestSummary, since: Date): string {
  const period = config.frequency === "daily" ? "日报" : "周报";
  const dateRange = `${since.toLocaleDateString("zh-CN")} ~ ${new Date().toLocaleDateString("zh-CN")}`;
  const sections: string[] = [];

  if (config.includeStats) {
    sections.push(`
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
        <tr>
          <td style="background:#f0f5ff;padding:12px;text-align:center;border:1px solid #e8e8e8"><div style="font-size:24px;color:#1890ff">${summary.stats.totalTickets}</div><div style="color:#666">攻关单总数</div></td>
          <td style="background:#f0f5ff;padding:12px;text-align:center;border:1px solid #e8e8e8"><div style="font-size:24px;color:#faad14">${summary.stats.openTickets}</div><div style="color:#666">进行中</div></td>
          <td style="background:#f0f5ff;padding:12px;text-align:center;border:1px solid #e8e8e8"><div style="font-size:24px;color:#52c41a">${summary.stats.resolvedToday}</div><div style="color:#666">已解决</div></td>
          <td style="background:#f0f5ff;padding:12px;text-align:center;border:1px solid #e8e8e8"><div style="font-size:24px;color:#722ed1">${summary.stats.totalContributions}</div><div style="color:#666">贡献总数</div></td>
        </tr>
      </table>`);
  }

  if (config.includeNewTickets && summary.newTickets.length > 0) {
    const rows = summary.newTickets
      .map(
        (t) =>
          `<tr><td style="padding:6px 10px;border:1px solid #e8e8e8">${esc(t.title)}</td><td style="padding:6px 10px;border:1px solid #e8e8e8">${esc(t.status)}</td></tr>`
      )
      .join("");
    sections.push(
      `<h3 style="color:#333">📝 新建攻关单 (${summary.newTickets.length})</h3><table style="width:100%;border-collapse:collapse;margin-bottom:16px"><tr style="background:#fafafa"><th style="padding:6px 10px;border:1px solid #e8e8e8;text-align:left">标题</th><th style="padding:6px 10px;border:1px solid #e8e8e8;text-align:left;width:100px">状态</th></tr>${rows}</table>`
    );
  }

  if (config.includeTransitions && summary.transitions.length > 0) {
    const rows = summary.transitions
      .map(
        (t) =>
          `<tr><td style="padding:6px 10px;border:1px solid #e8e8e8">${esc(t.title)}</td><td style="padding:6px 10px;border:1px solid #e8e8e8">${esc(t.from)} → ${esc(t.to)}</td><td style="padding:6px 10px;border:1px solid #e8e8e8">${esc(t.time)}</td></tr>`
      )
      .join("");
    sections.push(
      `<h3 style="color:#333">🔄 状态流转 (${summary.transitions.length})</h3><table style="width:100%;border-collapse:collapse;margin-bottom:16px"><tr style="background:#fafafa"><th style="padding:6px 10px;border:1px solid #e8e8e8;text-align:left">标题</th><th style="padding:6px 10px;border:1px solid #e8e8e8;text-align:left">变更</th><th style="padding:6px 10px;border:1px solid #e8e8e8;text-align:left;width:140px">时间</th></tr>${rows}</table>`
    );
  }

  if (config.includeContributions && summary.newContributions.length > 0) {
    const rows = summary.newContributions
      .map(
        (c) =>
          `<tr><td style="padding:6px 10px;border:1px solid #e8e8e8">${esc(c.person)}</td><td style="padding:6px 10px;border:1px solid #e8e8e8">${esc(c.type)}</td><td style="padding:6px 10px;border:1px solid #e8e8e8">${esc(c.level)}</td></tr>`
      )
      .join("");
    sections.push(
      `<h3 style="color:#333">🏆 新增贡献 (${summary.newContributions.length})</h3><table style="width:100%;border-collapse:collapse;margin-bottom:16px"><tr style="background:#fafafa"><th style="padding:6px 10px;border:1px solid #e8e8e8;text-align:left">贡献人</th><th style="padding:6px 10px;border:1px solid #e8e8e8;text-align:left">类型</th><th style="padding:6px 10px;border:1px solid #e8e8e8;text-align:left">等级</th></tr>${rows}</table>`
    );
  }

  if (sections.length === 0) {
    sections.push(`<p style="color:#999;text-align:center;padding:40px 0">本期无新动态</p>`);
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:700px;margin:0 auto;padding:20px;color:#333">
    <div style="background:linear-gradient(135deg,#1890ff,#722ed1);padding:24px;border-radius:8px 8px 0 0;text-align:center">
      <h1 style="color:#fff;margin:0;font-size:22px">作战管理平台 ${period}</h1>
      <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:14px">${dateRange}</p>
    </div>
    <div style="background:#fff;padding:20px;border:1px solid #e8e8e8;border-top:none">
      ${sections.join("")}
      <div style="border-top:1px solid #e8e8e8;padding-top:12px;margin-top:16px;text-align:center;color:#999;font-size:12px">
        此邮件由系统自动发送，请勿直接回复
      </div>
    </div>
  </body></html>`;
}

export async function sendDigest(
  adapter: DbAdapter,
  repo: Repository,
  mailSender: MailSender,
  smtpConfig: SmtpConfig,
  customDays?: number
): Promise<{ sent: boolean; error?: string }> {
  const digestRepo = new DigestRepo(adapter);
  const config = await digestRepo.getConfig();

  if (!config.enabled || config.recipients.length === 0) {
    return { sent: false, error: "未启用或无收件人" };
  }

  const days = customDays ?? (config.frequency === "daily" ? 1 : 7);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const summary = await buildDigestSummary(repo, since);
  const body = formatDigestEmail(config, summary, since);
  const html = buildDigestHtml(config, summary, since);
  const period = days === 1 ? "日报" : `${days}日汇总`;
  const subject = `【作战管理平台】${period} ${new Date().toLocaleDateString("zh-CN")}`;

  try {
    await mailSender.send(smtpConfig, { to: config.recipients, subject, body, html });
    await digestRepo.markSent();
    log.info("digest.sent", { recipients: config.recipients.length, frequency: config.frequency });
    return { sent: true };
  } catch (e: any) {
    log.warn("digest.send_fail", { error: e.message });
    return { sent: false, error: e.message };
  }
}
