import { Router } from "express";
import type { Repository, SchemaRegistry } from "@combat/shared";
import { HeuristicRelationProposer } from "./proposer.js";
import { mergePerson } from "./merge.js";

export function makeProposalsRouter(repo: Repository, registry: SchemaRegistry): Router {
  const r = Router();
  const proposers = [new HeuristicRelationProposer()];

  r.post("/proposals/scan", (_req, res) => {
    const existing = repo.listProposals();
    const seen = new Set(existing
      .filter(p => p.status === "待审批" || p.status === "已拒绝")
      .map(p => `${p.sourceNodeId}|${p.targetNodeId}|${p.relationType}`));
    let created = 0;
    for (const pr of proposers)
      for (const d of pr.propose(repo, registry)) {
        const k = `${d.sourceNodeId}|${d.targetNodeId}|${d.relationType}`;
        if (seen.has(k)) continue;
        seen.add(k);
        repo.createProposal(d, "scan");
        created++;
      }
    res.json({ created });
  });

  r.get("/proposals", (req, res) => {
    const status = req.query.status as string | undefined;
    res.json(repo.listProposals(status ? { status: status as any } : {}));
  });

  r.post("/proposals/:id/decide", (req, res) => {
    const p = repo.getProposal(req.params.id);
    if (!p) return res.status(404).json({ error: "proposal not found" });
    if (p.status !== "待审批") return res.status(409).json({ error: `已决策(${p.status})不可重复` });
    const { decision, decidedBy, patch } = req.body ?? {};
    if (!decidedBy || typeof decidedBy !== "string")
      return res.status(400).json({ error: "decidedBy 必填" });
    // H1 fix: accept both bare (通过/拒绝) and past-tense (已通过/已拒绝) so CLI/UI agree.
    const d = String(decision ?? "");
    if (d === "拒绝" || d === "已拒绝")
      return res.json(repo.updateProposalStatus(p.id, "已拒绝", decidedBy, decidedBy));
    if (d === "通过" || d === "已通过" || d === "修正") {
      const corrected = d === "修正" && patch?.targetNodeId;
      const target = corrected ? patch.targetNodeId : p.targetNodeId;
      if (corrected && !repo.getNode(patch.targetNodeId))
        return res.status(400).json({ error: `patch.targetNodeId 不存在: ${patch.targetNodeId}` });
      // M6 fix: SAME_AS merge only when both ends are person nodes.
      if (p.relationType === "SAME_AS") {
        const s = repo.getNode(p.sourceNodeId), t = repo.getNode(target);
        if (!s || !t) return res.status(400).json({ error: "合并节点不存在" });
        if (s.nodeType !== "person" || t.nodeType !== "person")
          return res.status(400).json({ error: "SAME_AS 仅支持 person 合并" });
        mergePerson(repo, p.sourceNodeId, target, decidedBy);
      }
      return res.json(repo.updateProposalStatus(p.id, "已通过", decidedBy, decidedBy));
    }
    return res.status(400).json({ error: "decision ∈ {通过,拒绝,修正}" });
  });

  return r;
}
