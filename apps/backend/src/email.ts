// §45: Email notification API — SMTP config (masked GET, password-preserving PUT),
// test send, and recipient-resolving send (to[] + emailGroup expansion + person email).
import { Router } from "express";
import type {
  Repository,
  SchemaRegistry,
  SmtpConfig,
  SmtpConfigMasked,
  EmailSendRequest,
  EmailSendResult,
} from "@combat/shared";
import type { MailSender } from "./mailer.js";
import { log, asyncHandler } from "./logger.js";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const EMPTY_MASK: SmtpConfigMasked = {
  host: "",
  port: 465,
  secure: true,
  username: "",
  fromEmail: "",
  passwordSet: false,
};

async function readConfig(repo: Repository): Promise<SmtpConfig | null> {
  const raw = await repo.getSetting("smtp");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SmtpConfig;
  } catch {
    return null;
  }
}

function mask(cfg: SmtpConfig): SmtpConfigMasked {
  const { password, ...rest } = cfg;
  return { ...rest, passwordSet: !!password };
}

/** trim → drop empties → email-regex filter → dedup (preserving first-seen order). */
function normalizeRecipients(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const v = String(r ?? "").trim();
    if (!v || !EMAIL_RE.test(v)) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

async function resolveRecipients(repo: Repository, req: EmailSendRequest): Promise<string[]> {
  const raw: string[] = [];
  for (const t of req.to ?? []) raw.push(t);
  for (const name of req.groupNames ?? []) {
    const trimmed = String(name ?? "").trim();
    if (!trimmed) continue;
    for (const g of await repo.queryNodes("emailGroup", { 组名: trimmed })) {
      const members = String(g.properties["成员邮箱"] ?? "");
      for (const m of members.split(",")) raw.push(m);
    }
  }
  for (const name of req.personNames ?? []) {
    const trimmed = String(name ?? "").trim();
    if (!trimmed) continue;
    const persons = (await repo.queryNodes("person")).filter(
      (p) =>
        String(p.properties["姓名"] ?? p.properties["name"] ?? "") === trimmed ||
        String(p.properties["工号"] ?? p.properties["employeeId"] ?? "") === trimmed
    );
    for (const p of persons) raw.push(String(p.properties["邮箱"] ?? p.properties["email"] ?? ""));
  }
  return normalizeRecipients(raw);
}

export function makeEmailRouter(repo: Repository, _registry: SchemaRegistry, mailSender: MailSender): Router {
  const r = Router();

  r.get("/email/config", async (_req, res) => {
    const cfg = await readConfig(repo);
    res.json(cfg ? mask(cfg) : EMPTY_MASK);
  });

  r.put("/email/config", async (req, res) => {
    const body = (req.body ?? {}) as Partial<SmtpConfig>;
    const old = await readConfig(repo);
    const password = body.password && String(body.password).length > 0 ? String(body.password) : (old?.password ?? "");
    const cfg: SmtpConfig = {
      host: String(body.host ?? ""),
      port: Number(body.port ?? 465),
      secure: body.secure === undefined ? true : !!body.secure,
      username: String(body.username ?? ""),
      password,
      fromEmail: String(body.fromEmail ?? ""),
      fromName: body.fromName !== undefined ? String(body.fromName) : undefined,
    };
    await repo.setSetting("smtp", JSON.stringify(cfg), "api");
    res.json(mask(cfg));
  });

  r.post(
    "/email/test",
    asyncHandler(async (req, res) => {
      const cfg = await readConfig(repo);
      if (!cfg) return res.status(400).json({ error: "未配置 SMTP" });
      const to = String((req.body ?? {}).to ?? "").trim();
      if (!to || !EMAIL_RE.test(to)) return res.status(400).json({ error: "to 必须是有效邮箱" });
      const recipients = [to];
      try {
        const { messageId } = await mailSender.send(cfg, {
          to: recipients,
          subject: "作战管理工具 测试邮件",
          body: "这是一封来自作战管理工具的测试邮件。",
        });
        log.info("email.test", { recipients: recipients.length, ok: true, messageId });
        res.json({ recipients, ok: true, messageId } as EmailSendResult);
      } catch (e) {
        log.error("email.test", { recipients: recipients.length, ok: false, error: (e as Error).message });
        res.json({ recipients, ok: false, error: (e as Error).message } as EmailSendResult);
      }
    })
  );

  r.post(
    "/email/send",
    asyncHandler(async (req, res) => {
      const cfg = await readConfig(repo);
      if (!cfg) return res.status(400).json({ error: "未配置 SMTP" });
      const body = (req.body ?? {}) as EmailSendRequest;
      const recipients = await resolveRecipients(repo, body);
      if (recipients.length === 0) return res.status(400).json({ error: "无有效收件人" });
      try {
        const { messageId } = await mailSender.send(cfg, {
          to: recipients,
          subject: String(body.subject ?? ""),
          body: String(body.body ?? ""),
        });
        log.info("email.send", { recipients: recipients.length, ok: true, messageId });
        res.json({ recipients, ok: true, messageId } as EmailSendResult);
      } catch (e) {
        log.error("email.send", { recipients: recipients.length, ok: false, error: (e as Error).message });
        res.json({ recipients, ok: false, error: (e as Error).message } as EmailSendResult);
      }
    })
  );

  return r;
}
