import { Router } from "express";
import type { Repository, OncallCurrentRow } from "@combat/shared";
import { localToday } from "./date-util.js";

/**
 * §51.3: derive who is on call today from oncall nodes. A node is current when
 * today ∈ [起, 止] (inclusive, lexicographic on ISO date works). "Today" is the
 * Asia/Shanghai calendar date (起/止 are entered as local dates). Date-derived,
 * no state written. Optionally filtered by domain. Grouped by domain.
 */
export function currentOncall(repo: Repository, domain?: string): OncallCurrentRow[] {
  const day = localToday();
  const byDomain = new Map<string, Set<string>>();
  for (const n of repo.queryNodes("oncall")) {
    const d = String(n.properties["domain"] ?? "").trim();
    if (!d || (domain && d !== domain)) continue;
    const from = String(n.properties["起"] ?? "").trim();
    const to = String(n.properties["止"] ?? "").trim();
    if (from && day < from) continue;
    if (to && day > to) continue;
    const person = String(n.properties["值班人"] ?? "").trim();
    if (!person) continue;
    if (!byDomain.has(d)) byDomain.set(d, new Set());
    byDomain.get(d)!.add(person);
  }
  return [...byDomain].map(([d, people]) => ({ domain: d, 值班人: [...people] }));
}

export function makeOncallRouter(repo: Repository): Router {
  const r = Router();
  r.get("/oncall/current", (req, res) => {
    const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
    const domain = req.query.domain != null ? String(first(req.query.domain)) : undefined;
    res.json(currentOncall(repo, domain || undefined));
  });
  return r;
}
