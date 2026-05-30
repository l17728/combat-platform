import { Router } from "express";
import type { Repository } from "@combat/shared";

export function makeAuditRouter(repo: Repository): Router {
  const r = Router();
  r.get("/audit", async (req, res) => {
    const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
    const filter = {
      action: req.query.action ? String(first(req.query.action)) : undefined,
      entityType: req.query.entityType ? String(first(req.query.entityType)) : undefined,
      entityId: req.query.entityId ? String(first(req.query.entityId)) : undefined,
      limit: req.query.limit ? Number(first(req.query.limit)) : undefined,
    };
    res.json(await repo.listAuditLog(filter));
  });
  return r;
}
