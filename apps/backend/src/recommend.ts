import { Router } from "express";
import type { Repository, GraphNode, HelperRecommendation } from "@combat/shared";

const LEVEL: Record<string, number> = { 核心: 3, 关键: 2, 普通: 1 };

function refPersons(repo: Repository, srcId: string, field: string): string[] {
  return repo.queryEdges({ sourceId: srcId, edgeType: "REF" })
    .filter(e => String(e.properties["field"] ?? "") === field)
    .map(e => e.targetId);
}

export function recommendHelpers(repo: Repository, ticketId: string, limit = 10): HelperRecommendation[] {
  const T = repo.getNode(ticketId);
  if (!T) return [];
  const self = new Set(refPersons(repo, T.id, "当前处理人"));
  const acc = new Map<string, { score: number; reasons: string[] }>();
  const add = (pid: string, s: number, reason: string) => {
    if (self.has(pid)) return;
    const e = acc.get(pid) ?? { score: 0, reasons: [] };
    e.score += s; e.reasons.push(reason); acc.set(pid, e);
  };

  for (const ae of repo.queryEdges({ sourceId: T.id, edgeType: "ANCHORED_TO" })) {
    const anchor = repo.getNode(ae.targetId);
    if (!anchor) continue;
    const key = String(anchor.properties["key"] ?? "");
    for (const back of repo.queryEdges({ targetId: anchor.id, edgeType: "ANCHORED_TO" })) {
      if (back.sourceId === T.id) continue;
      const s = repo.getNode(back.sourceId);
      if (!s) continue;
      if (s.nodeType === "attackTicket")
        for (const pid of refPersons(repo, s.id, "当前处理人"))
          add(pid, 3, `曾处理共享问题单「${key}」的攻关单「${String(s.properties["标题"] ?? s.id)}」`);
      else if (s.nodeType === "contribution") {
        const lvl = String(s.properties["贡献等级"] ?? "普通");
        const desc = String(s.properties["贡献描述"] ?? s.properties["贡献类型"] ?? "");
        for (const pid of refPersons(repo, s.id, "贡献人"))
          add(pid, LEVEL[lvl] ?? 1, `在共享问题单「${key}」相关贡献「${desc}」（${lvl}）`);
      }
    }
  }

  const fbCount = new Map<string, number>();
  for (const c of repo.queryNodes("contribution")) {
    const lvl = String(c.properties["贡献等级"] ?? "");
    if (lvl !== "核心" && lvl !== "关键") continue;
    for (const pid of refPersons(repo, c.id, "贡献人")) {
      // last-resort: skip self AND anyone already credited via shared-anchor
      // evidence (acc is fully built by the anchor pass above)
      if (self.has(pid) || acc.has(pid)) continue;
      fbCount.set(pid, (fbCount.get(pid) ?? 0) + 1);
    }
  }
  for (const [pid, n] of fbCount) {
    const e = acc.get(pid) ?? { score: 0, reasons: [] };
    e.score += Math.min(n, 3); e.reasons.push(`历史核心/关键贡献 ${n} 次`); acc.set(pid, e);
  }

  const name = (n: GraphNode) => String(n.properties["name"] ?? n.id);
  const out = [...acc.entries()]
    .map(([pid, e]) => ({ person: repo.getNode(pid), score: e.score, reasons: e.reasons }))
    .filter((x): x is HelperRecommendation => !!x.person);
  out.sort((a, b) => {
    const na = name(a.person), nb = name(b.person);
    return b.score - a.score || (na < nb ? -1 : na > nb ? 1 : a.person.id < b.person.id ? -1 : 1);
  });
  return out.slice(0, Math.max(1, Math.min(50, limit)));
}

export function makeRecommendRouter(repo: Repository): Router {
  const r = Router();
  r.get("/recommend/helpers/:id", (req, res) => {
    const node = repo.getNode(req.params.id);
    if (!node) return res.status(404).json({ error: "not found" });
    if (node.nodeType !== "attackTicket") return res.status(400).json({ error: "仅支持 attackTicket" });
    const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
    const limit = Number(first(req.query.limit)) || 10;
    res.json(recommendHelpers(repo, node.id, limit));
  });
  return r;
}
