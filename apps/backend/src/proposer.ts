import type { Repository, SchemaRegistry, ProposalDraft, RelationProposer } from "@combat/shared";

export function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i-1][j] + 1, d[i][j-1] + 1,
        d[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
  return d[m][n];
}
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "");

export class HeuristicRelationProposer implements RelationProposer {
  constructor(private threshold = 1, private source = "heuristic-v1") {}
  propose(repo: Repository, registry: SchemaRegistry): ProposalDraft[] {
    const cfg = registry.getConfig();
    const refTypes = new Set<string>();
    for (const ns of cfg.nodeTypes)
      for (const f of ns.fields) if (f.type === "ref" && f.refType) refTypes.add(f.refType);
    const out: ProposalDraft[] = [];
    for (const rt of [...refTypes].sort()) {
      const nodes = repo.queryNodes(rt)
        .map(n => ({ id: n.id, key: norm(String(n.properties["姓名"] ?? n.properties["name"] ?? n.id)),
          emp: norm(String(n.properties["工号"] ?? n.properties["employeeId"] ?? "")) }))
        .sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : (a.id < b.id ? -1 : 1));
      for (let i = 0; i < nodes.length; i++)
        for (let j = i + 1; j < nodes.length; j++) {
          const A = nodes[i], B = nodes[j];
          if (!A.key || !B.key) continue;
          const dist = levenshtein(A.key, B.key);
          // §55.1: identical normalized name is a strong duplicate signal — propose
          // SAME_AS (conf 1.0) UNLESS both carry an employeeId and they differ
          // (then they are distinct people, not a dup).
          if (dist === 0) {
            if (A.emp && B.emp && A.emp !== B.emp) continue;
            out.push({ sourceNodeId: A.id, targetNodeId: B.id, relationType: "SAME_AS",
              confidence: 1, proposerSource: this.source, rationale: `完全同名:${A.key}` });
            continue;
          }
          const maxLen = Math.max(A.key.length, B.key.length);
          if (dist > this.threshold) continue;
          out.push({ sourceNodeId: A.id, targetNodeId: B.id, relationType: "SAME_AS",
            confidence: Math.round((1 - dist / maxLen) * 100) / 100,
            proposerSource: this.source, rationale: `${A.key}≈${B.key} dist=${dist}` });
        }
    }
    return out;
  }
}
