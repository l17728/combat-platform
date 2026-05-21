import { Router } from "express";
import type { Repository } from "@combat/shared";
import { mergePerson, previewMerge } from "./merge.js";

function assertPersons(repo: Repository, fromId: string, toId: string): string | null {
  if (!fromId || !toId) return "fromId 与 toId 必填";
  if (fromId === toId) return "不能与自身合并";
  const from = repo.getNode(fromId), to = repo.getNode(toId);
  if (!from || !to) return "节点不存在";
  if (from.nodeType !== "person" || to.nodeType !== "person") return "仅支持 person 合并";
  return null;
}

export function makeMergeRouter(repo: Repository): Router {
  const r = Router();
  r.get("/merge/preview", (req, res) => {
    const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
    const fromId = String(first(req.query.fromId) ?? "");
    const toId = String(first(req.query.toId) ?? "");
    const err = assertPersons(repo, fromId, toId);
    if (err) return res.status(400).json({ error: err });
    res.json(previewMerge(repo, fromId, toId));
  });
  r.post("/merge/person", (req, res) => {
    const fromId = String(req.body?.fromId ?? "");
    const toId = String(req.body?.toId ?? "");
    const err = assertPersons(repo, fromId, toId);
    if (err) return res.status(400).json({ error: err });
    mergePerson(repo, fromId, toId, "ui");
    res.json(repo.getNode(toId));
  });
  return r;
}
