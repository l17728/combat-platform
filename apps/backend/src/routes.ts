import { Router } from "express";
import type { Repository, SchemaRegistry } from "@combat/shared";

export function makeRouter(repo: Repository, registry: SchemaRegistry): Router {
  const r = Router();

  r.get("/schema/:nodeType", (req, res) => {
    const s = registry.getNodeSchema(req.params.nodeType);
    return s ? res.json(s) : res.status(404).json({ error: "unknown nodeType" });
  });
  r.post("/schema/scan", (_req, res) => {
    try {
      registry.reload();
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  r.get("/nodes/:nodeType", (req, res) => {
    const { nodeType } = req.params;
    if (registry.getNodeSchema(nodeType)) {
      const filter = { ...req.query } as Record<string, unknown>;
      return res.json(repo.queryNodes(nodeType, Object.keys(filter).length ? filter : undefined));
    }
    const single = repo.getNode(nodeType);
    return single ? res.json(single) : res.status(404).json({ error: "not found" });
  });

  r.post("/nodes/:nodeType", (req, res) => {
    const { nodeType } = req.params;
    const v = registry.validateNode(nodeType, req.body);
    if (!v.ok) return res.status(400).json({ errors: v.errors });
    res.status(201).json(repo.createNode(nodeType, req.body, "api"));
  });

  r.get("/nodes/:id/progress", (req, res) => res.json(repo.listProgress(req.params.id)));
  r.post("/nodes/:id/progress", (req, res) => {
    const { content, statusSnapshot, actor } = req.body;
    res.status(201).json(repo.appendProgress(req.params.id, content, statusSnapshot, actor ?? "api"));
  });

  return r;
}
