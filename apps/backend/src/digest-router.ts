import { Router } from "express";
import type { DbAdapter } from "./db-adapter.js";
import type { Repository } from "@combat/shared";
import type { MailSender } from "./mailer.js";
import { DigestRepo, ensureDigestTable, buildDigestSummary, sendDigest } from "./digest.js";
import { readConfig } from "./email.js";
import { log, asyncHandler } from "./logger.js";
import { adminMiddleware } from "./auth.js";

export function makeDigestRouter(adapter: DbAdapter, repo: Repository, mailSender: MailSender): Router {
  ensureDigestTable(adapter).catch((e) => log.warn("digest.ensure_table.fail", { error: (e as Error).message }));

  const r = Router();
  const digestRepo = new DigestRepo(adapter);

  r.get(
    "/digest/config",
    asyncHandler(async (_req, res) => {
      const config = await digestRepo.getConfig();
      res.json(config);
    })
  );

  r.patch(
    "/digest/config",
    adminMiddleware,
    asyncHandler(async (req, res) => {
      const config = await digestRepo.updateConfig(req.body);
      res.json(config);
    })
  );

  r.get(
    "/digest/preview",
    adminMiddleware,
    asyncHandler(async (_req, res) => {
      const config = await digestRepo.getConfig();
      const since =
        config.frequency === "daily"
          ? new Date(Date.now() - 24 * 60 * 60 * 1000)
          : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const summary = await buildDigestSummary(repo, since);
      res.json({ since: since.toISOString(), ...summary });
    })
  );

  r.post(
    "/digest/send",
    adminMiddleware,
    asyncHandler(async (_req, res) => {
      const smtpConfig = await readConfig(repo);
      if (!smtpConfig) {
        res.status(400).json({ error: "请先配置 SMTP" });
        return;
      }
      const result = await sendDigest(adapter, repo, mailSender, smtpConfig);
      res.json(result);
    })
  );

  return r;
}
