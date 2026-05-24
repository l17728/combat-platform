import { Router } from "express";
import type { DB } from "./db.js";
import { randomUUID } from "node:crypto";
import { log } from "./logger.js";

export interface SupportNode {
  id: string; ticketId: string | null; templateId: string | null;
  parentId: string | null; category: string; domain: string;
  personId: string | null; personName: string | null;
  status: string; note: string; createdAt: string; resolvedAt: string | null;
}
export interface SupportTemplate {
  id: string; name: string; description: string;
  usageCount: number; createdAt: string;
}

function toNode(r: any): SupportNode {
  return {
    id: r.id,
    ticketId: r.ticket_id ?? null,
    templateId: r.template_id ?? null,
    parentId: r.parent_id ?? null,
    category: r.category,
    domain: r.domain,
    personId: r.person_id ?? null,
    personName: r.person_name ?? null,
    status: r.status,
    note: r.note,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at ?? null,
  };
}

function toTemplate(r: any): SupportTemplate {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    usageCount: r.usage_count,
    createdAt: r.created_at,
  };
}

/** Recursively collect nodeIds that are descendants of parentId (including itself). */
function collectDescendants(db: DB, nodeId: string): string[] {
  const ids: string[] = [nodeId];
  const children = db.prepare(`SELECT id FROM support_node WHERE parent_id=?`).all(nodeId) as any[];
  for (const child of children) {
    ids.push(...collectDescendants(db, child.id));
  }
  return ids;
}

export function makeSupportNodeRouter(db: DB): Router {
  const r = Router();

  // GET /api/support-nodes/:ticketId
  r.get("/support-nodes/:ticketId", (req, res) => {
    const rows = db.prepare(
      `SELECT * FROM support_node WHERE ticket_id=? ORDER BY created_at ASC`
    ).all(req.params.ticketId) as any[];
    res.json(rows.map(toNode));
  });

  // POST /api/support-nodes/:ticketId
  r.post("/support-nodes/:ticketId", (req, res) => {
    const { parentId, category, domain, personId, personName, status = "待确认", note = "" } = req.body ?? {};
    if (!category || !domain) {
      return res.status(400).json({ error: "category 和 domain 为必填项" });
    }
    const node: SupportNode = {
      id: randomUUID(),
      ticketId: req.params.ticketId,
      templateId: null,
      parentId: parentId ?? null,
      category,
      domain,
      personId: personId ?? null,
      personName: personName ?? null,
      status,
      note,
      createdAt: new Date().toISOString(),
      resolvedAt: null,
    };
    db.prepare(
      `INSERT INTO support_node (id, ticket_id, template_id, parent_id, category, domain, person_id, person_name, status, note, created_at, resolved_at)
       VALUES (@id, @ticket_id, @template_id, @parent_id, @category, @domain, @person_id, @person_name, @status, @note, @created_at, @resolved_at)`
    ).run({
      id: node.id,
      ticket_id: node.ticketId,
      template_id: node.templateId,
      parent_id: node.parentId,
      category: node.category,
      domain: node.domain,
      person_id: node.personId,
      person_name: node.personName,
      status: node.status,
      note: node.note,
      created_at: node.createdAt,
      resolved_at: node.resolvedAt,
    });
    log.info("support_node.create", { ticketId: req.params.ticketId, id: node.id });
    res.status(201).json(node);
  });

  // PUT /api/support-nodes/node/:nodeId
  r.put("/support-nodes/node/:nodeId", (req, res) => {
    const existing = db.prepare(`SELECT * FROM support_node WHERE id=?`).get(req.params.nodeId) as any;
    if (!existing) return res.status(404).json({ error: "not found" });

    const body = req.body ?? {};
    const updates: Record<string, any> = {};
    const allowed = ["parentId", "category", "domain", "personId", "personName", "status", "note", "resolvedAt"];
    const dbMap: Record<string, string> = {
      parentId: "parent_id", category: "category", domain: "domain",
      personId: "person_id", personName: "person_name", status: "status",
      note: "note", resolvedAt: "resolved_at",
    };
    for (const key of allowed) {
      if (key in body) {
        updates[dbMap[key]] = body[key];
      }
    }
    if (Object.keys(updates).length === 0) {
      return res.json(toNode(existing));
    }
    const setClauses = Object.keys(updates).map(k => `${k}=@${k}`).join(", ");
    db.prepare(`UPDATE support_node SET ${setClauses} WHERE id=@id`).run({ ...updates, id: req.params.nodeId });
    const updated = db.prepare(`SELECT * FROM support_node WHERE id=?`).get(req.params.nodeId) as any;
    log.info("support_node.update", { id: req.params.nodeId });
    res.json(toNode(updated));
  });

  // DELETE /api/support-nodes/node/:nodeId
  r.delete("/support-nodes/node/:nodeId", (req, res) => {
    const existing = db.prepare(`SELECT * FROM support_node WHERE id=?`).get(req.params.nodeId) as any;
    if (!existing) return res.status(404).json({ error: "not found" });
    const ids = collectDescendants(db, req.params.nodeId);
    const placeholders = ids.map(() => "?").join(",");
    const result = db.prepare(`DELETE FROM support_node WHERE id IN (${placeholders})`).run(...ids);
    log.info("support_node.delete", { id: req.params.nodeId, deleted: result.changes });
    res.json({ deleted: result.changes });
  });

  // GET /api/support-templates
  r.get("/support-templates", (_req, res) => {
    const rows = db.prepare(`SELECT * FROM support_template ORDER BY usage_count DESC`).all() as any[];
    res.json(rows.map(toTemplate));
  });

  // POST /api/support-templates
  r.post("/support-templates", (req, res) => {
    const { name, description = "", nodes = [] } = req.body ?? {};
    if (!name) return res.status(400).json({ error: "name 为必填项" });

    const template: SupportTemplate = {
      id: randomUUID(),
      name,
      description,
      usageCount: 0,
      createdAt: new Date().toISOString(),
    };
    db.prepare(
      `INSERT INTO support_template (id, name, description, usage_count, created_at) VALUES (@id, @name, @description, @usage_count, @created_at)`
    ).run({ id: template.id, name: template.name, description: template.description, usage_count: 0, created_at: template.createdAt });

    // Insert template nodes; parentIndex references the array index of the parent node
    const createdNodes: SupportNode[] = [];
    const idByIndex: string[] = [];
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (!n.category || !n.domain) continue;
      const nodeId = randomUUID();
      idByIndex[i] = nodeId;
      const parentId = n.parentIndex !== undefined && idByIndex[n.parentIndex] ? idByIndex[n.parentIndex] : null;
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO support_node (id, ticket_id, template_id, parent_id, category, domain, person_id, person_name, status, note, created_at, resolved_at)
         VALUES (@id, @ticket_id, @template_id, @parent_id, @category, @domain, @person_id, @person_name, @status, @note, @created_at, @resolved_at)`
      ).run({
        id: nodeId, ticket_id: null, template_id: template.id, parent_id: parentId,
        category: n.category, domain: n.domain,
        person_id: n.personId ?? null, person_name: n.personName ?? null,
        status: n.status ?? "待确认", note: n.note ?? "", created_at: now, resolved_at: null,
      });
      createdNodes.push(toNode(db.prepare(`SELECT * FROM support_node WHERE id=?`).get(nodeId)));
    }
    log.info("support_template.create", { id: template.id, nodeCount: createdNodes.length });
    res.status(201).json({ template, nodes: createdNodes });
  });

  // POST /api/support-templates/:templateId/apply/:ticketId
  r.post("/support-templates/:templateId/apply/:ticketId", (req, res) => {
    const tmpl = db.prepare(`SELECT * FROM support_template WHERE id=?`).get(req.params.templateId) as any;
    if (!tmpl) return res.status(404).json({ error: "template not found" });

    const templateNodes = db.prepare(
      `SELECT * FROM support_node WHERE template_id=? AND ticket_id IS NULL ORDER BY created_at ASC`
    ).all(req.params.templateId) as any[];

    const oldToNew: Map<string, string> = new Map();
    const cloned: SupportNode[] = [];
    const now = new Date().toISOString();

    // First pass: create new IDs
    for (const n of templateNodes) {
      oldToNew.set(n.id, randomUUID());
    }

    // Second pass: insert with mapped parent_id
    for (const n of templateNodes) {
      const newId = oldToNew.get(n.id)!;
      const newParentId = n.parent_id ? (oldToNew.get(n.parent_id) ?? null) : null;
      db.prepare(
        `INSERT INTO support_node (id, ticket_id, template_id, parent_id, category, domain, person_id, person_name, status, note, created_at, resolved_at)
         VALUES (@id, @ticket_id, @template_id, @parent_id, @category, @domain, @person_id, @person_name, @status, @note, @created_at, @resolved_at)`
      ).run({
        id: newId, ticket_id: req.params.ticketId, template_id: req.params.templateId,
        parent_id: newParentId, category: n.category, domain: n.domain,
        person_id: n.person_id ?? null, person_name: n.person_name ?? null,
        status: n.status, note: n.note, created_at: now, resolved_at: null,
      });
      cloned.push(toNode(db.prepare(`SELECT * FROM support_node WHERE id=?`).get(newId)));
    }

    db.prepare(`UPDATE support_template SET usage_count = usage_count + 1 WHERE id=?`).run(req.params.templateId);
    log.info("support_template.apply", { templateId: req.params.templateId, ticketId: req.params.ticketId, applied: cloned.length });
    res.json({ applied: cloned.length, nodes: cloned });
  });

  // DELETE /api/support-templates/:templateId
  r.delete("/support-templates/:templateId", (req, res) => {
    const tmpl = db.prepare(`SELECT * FROM support_template WHERE id=?`).get(req.params.templateId) as any;
    if (!tmpl) return res.status(404).json({ error: "template not found" });

    const nodeResult = db.prepare(
      `DELETE FROM support_node WHERE template_id=? AND ticket_id IS NULL`
    ).run(req.params.templateId);
    db.prepare(`DELETE FROM support_template WHERE id=?`).run(req.params.templateId);
    log.info("support_template.delete", { id: req.params.templateId, nodesDeleted: nodeResult.changes });
    res.json({ deleted: nodeResult.changes + 1 });
  });

  return r;
}
