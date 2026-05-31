// §45: Email sending abstraction. MailSender is injected into the email router
// so e2e tests use a deterministic fake while production uses NodemailerSender.
import nodemailer from "nodemailer";
import type { SmtpConfig } from "@combat/shared";

export interface MailMessage {
  to: string[];
  subject: string;
  body: string;
  html?: string;
  attachments?: Array<{ filename: string; content: Buffer | string; contentType?: string }>;
}

export interface MailSender {
  send(cfg: SmtpConfig, msg: MailMessage): Promise<{ messageId: string }>;
}

export class NodemailerSender implements MailSender {
  async send(cfg: SmtpConfig, msg: MailMessage): Promise<{ messageId: string }> {
    const transportOpts: Record<string, unknown> = {
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: { user: cfg.username, pass: cfg.password },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
    };
    if (!cfg.secure && cfg.port === 587) {
      transportOpts.requireTLS = true;
    }
    const transport = nodemailer.createTransport(transportOpts);
    const from = cfg.fromName ? `${cfg.fromName} <${cfg.fromEmail}>` : cfg.fromEmail;
    const mailOpts: Record<string, unknown> = {
      from,
      to: msg.to.join(","),
      subject: msg.subject,
      text: msg.body,
    };
    if (msg.html) mailOpts.html = msg.html;
    if (msg.attachments?.length) {
      mailOpts.attachments = msg.attachments.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      }));
    }
    const info = await transport.sendMail(mailOpts);
    return { messageId: String((info as { messageId?: string }).messageId ?? "") };
  }
}
