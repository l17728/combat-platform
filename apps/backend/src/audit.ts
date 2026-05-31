import { Router } from "express";
import type { Repository } from "@combat/shared";
import { getAccessibleTicketIds } from "./private-tickets.js";

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
    const rows = await repo.listAuditLog(filter);
    // 私密攻关单全集过滤 (P1):审计日志里 entityType=node 且 entityId 是 attackTicket 时,
    // 若非授权用户,剔除条目。其它 entityType (schema/setting/edge 等) 不动。
    // adminMiddleware 已挡在前面 → 这里看到 req.user 必然是 admin (或 COMBAT_NO_AUTH bypass);
    // admin 仍然要受 createur/成员/授权 限制以保护私密单元数据(否则 admin 可从审计还原标题/状态)。
    const reqUser = (req as any).user as { username?: string; displayName?: string } | undefined;
    const allowedIds = await getAccessibleTicketIds(repo, reqUser);
    if (allowedIds === null) return res.json(rows);
    const nodeIds = Array.from(new Set(rows.filter((r) => r.entityType === "node").map((r) => r.entityId)));
    const ticketIdSet = new Set<string>();
    for (const id of nodeIds) {
      const n = await repo.getNode(id);
      if (n && n.nodeType === "attackTicket") ticketIdSet.add(id);
    }
    const filtered = rows.filter((r) => {
      if (r.entityType !== "node") return true;
      if (!ticketIdSet.has(r.entityId)) return true;
      return allowedIds.has(r.entityId);
    });
    res.json(filtered);
  });
  return r;
}
