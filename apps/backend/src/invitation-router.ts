import { Router } from "express";
import type { DbAdapter } from "./db-adapter.js";
import type { Repository } from "@combat/shared";
import type { MailSender } from "./mailer.js";
import type { SmtpConfig } from "@combat/shared";
import { InvitationRepo, ensureInvitationsTable } from "./invitation.js";
import { readConfig } from "./email.js";
import { log, asyncHandler } from "./logger.js";
import { adminMiddleware } from "./auth.js";

export function makeInvitationRouter(adapter: DbAdapter, repo: Repository, mailSender: MailSender): Router {
  ensureInvitationsTable(adapter).catch((e) =>
    log.warn("invitation.ensure_table.fail", { error: (e as Error).message })
  );

  const r = Router();
  const invRepo = new InvitationRepo(adapter);

  r.get(
    "/invitations",
    adminMiddleware,
    asyncHandler(async (_req, res) => {
      const list = await invRepo.list();
      res.json(list);
    })
  );

  r.post(
    "/invitations",
    adminMiddleware,
    asyncHandler(async (req, res) => {
      const { role, email, displayName, expiresInDays } = req.body;
      if (!email) {
        res.status(400).json({ error: "邮箱必填" });
        return;
      }
      const user = (req as any).user;
      const inv = await invRepo.create({
        role: role || "normal",
        email,
        displayName: displayName || "",
        createdBy: user?.username || "",
        expiresInDays: expiresInDays ? Number(expiresInDays) : undefined,
      });

      const smtpConfig = await readConfig(repo);
      if (smtpConfig) {
        const baseUrl = process.env.COMBAT_BASE_URL || "http://124.156.193.122:3001";
        const inviteUrl = `${baseUrl}/invite?code=${inv.code}`;
        mailSender
          .send(smtpConfig, {
            to: [email],
            subject: `【作战管理平台】邀请加入 — ${role === "admin" ? "管理员" : role === "leader" ? "负责人" : "成员"}`,
            body: `您已被邀请加入作战管理平台。\n\n角色：${role === "admin" ? "管理员" : role === "leader" ? "负责人" : "普通成员"}\n\n请点击以下链接完成注册：\n${inviteUrl}\n\n邀请码：${inv.code}\n\n此链接 ${expiresInDays || 7} 天内有效。`,
            html: `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
          <div style="background:linear-gradient(135deg,#1890ff,#722ed1);padding:24px;border-radius:8px 8px 0 0;text-align:center">
            <h1 style="color:#fff;margin:0">作战管理平台邀请</h1>
          </div>
          <div style="background:#fff;padding:24px;border:1px solid #e8e8e8;border-top:none">
            <p>您好，</p>
            <p>您已被邀请加入作战管理平台，角色为 <strong>${role === "admin" ? "管理员" : role === "leader" ? "负责人" : "普通成员"}</strong>。</p>
            <div style="text-align:center;margin:24px 0">
              <a href="${inviteUrl}" style="background:#1890ff;color:#fff;padding:12px 32px;border-radius:6px;text-decoration:none;font-size:16px">立即加入</a>
            </div>
            <p style="color:#999;font-size:13px">或复制链接到浏览器打开：<br>${inviteUrl}</p>
            <p style="color:#999;font-size:13px">邀请码：${inv.code}（${expiresInDays || 7} 天内有效）</p>
          </div>
        </body></html>`,
          })
          .then(() => log.info("invitation.email_sent", { id: inv.id, email }))
          .catch((e) => log.warn("invitation.email_fail", { id: inv.id, error: (e as Error).message }));
      }

      res.status(201).json(inv);
    })
  );

  r.get(
    "/invitations/check/:code",
    asyncHandler(async (req, res) => {
      const inv = await invRepo.getByCode(req.params.code);
      if (!inv) {
        res.status(404).json({ error: "邀请码不存在" });
        return;
      }
      if (inv.usedBy) {
        res.status(410).json({ error: "邀请码已使用" });
        return;
      }
      if (new Date(inv.expiresAt) < new Date()) {
        res.status(410).json({ error: "邀请码已过期" });
        return;
      }
      res.json({ role: inv.role, email: inv.email, displayName: inv.displayName });
    })
  );

  r.delete(
    "/invitations/:id",
    adminMiddleware,
    asyncHandler(async (req, res) => {
      const ok = await invRepo.delete(req.params.id);
      if (!ok) {
        res.status(404).json({ error: "未找到" });
        return;
      }
      res.json({ ok: true });
    })
  );

  return r;
}
