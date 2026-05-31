import { Router } from "express";
import type { DbAdapter } from "./db-adapter.js";
import { verifyAuditChain, ensureAuditChainColumns } from "./audit-chain.js";

export { ensureAuditChainColumns };

/**
 * resilience(audit-merkle): expose chain verification as HTTP endpoint so
 * the `audit:verify` CLI works against running backends. Admin-guarded at
 * the /api/audit/* prefix in app.ts (mounted before the existing audit router
 * — same prefix is fine, GET is read-only).
 */
export function makeAuditChainRouter(adapter: DbAdapter): Router {
  const r = Router();
  r.get("/audit/verify", async (_req, res) => {
    try {
      const result = await verifyAuditChain(adapter);
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });
  return r;
}
