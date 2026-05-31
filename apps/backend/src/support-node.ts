import { Router } from "express";
import type { DbAdapter } from "./db-adapter.js";
import { randomUUID } from "node:crypto";
import { log, asyncHandler } from "./logger.js";

export interface SupportNode {
  id: string;
  ticketId: string | null;
  templateId: string | null;
  parentId: string | null;
  category: string;
  domain: string;
  personId: string | null;
  personName: string | null;
  status: string;
  note: string;
  createdAt: string;
  resolvedAt: string | null;
}
export interface SupportTemplate {
  id: string;
  name: string;
  description: string;
  usageCount: number;
  createdAt: string;
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
async function collectDescendants(adapter: DbAdapter, nodeId: string): Promise<string[]> {
  const ids: string[] = [nodeId];
  const children = await adapter.query<{ id: string }>(`SELECT id FROM support_node WHERE parent_id=?`, [nodeId]);
  for (const child of children) {
    const descendants = await collectDescendants(adapter, child.id);
    ids.push(...descendants);
  }
  return ids;
}

const INSERT_NODE_SQL = `INSERT INTO support_node (id, ticket_id, template_id, parent_id, category, domain, person_id, person_name, status, note, created_at, resolved_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export function makeSupportNodeRouter(adapter: DbAdapter): Router {
  const r = Router();

  // GET /api/support-nodes/:ticketId
  r.get(
    "/support-nodes/:ticketId",
    asyncHandler(async (req, res) => {
      const rows = await adapter.query<any>(`SELECT * FROM support_node WHERE ticket_id=? ORDER BY created_at ASC`, [
        req.params.ticketId,
      ]);
      res.json(rows.map(toNode));
    })
  );

  // POST /api/support-nodes/:ticketId
  r.post(
    "/support-nodes/:ticketId",
    asyncHandler(async (req, res) => {
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
      await adapter.run(INSERT_NODE_SQL, [
        node.id,
        node.ticketId,
        node.templateId,
        node.parentId,
        node.category,
        node.domain,
        node.personId,
        node.personName,
        node.status,
        node.note,
        node.createdAt,
        node.resolvedAt,
      ]);
      log.info("support_node.create", { ticketId: req.params.ticketId, id: node.id });
      res.status(201).json(node);
    })
  );

  // PUT /api/support-nodes/node/:nodeId
  r.put(
    "/support-nodes/node/:nodeId",
    asyncHandler(async (req, res) => {
      const existing = await adapter.queryOne<any>(`SELECT * FROM support_node WHERE id=?`, [req.params.nodeId]);
      if (!existing) return res.status(404).json({ error: "not found" });

      const body = req.body ?? {};
      const allowed = ["parentId", "category", "domain", "personId", "personName", "status", "note", "resolvedAt"];
      const dbMap: Record<string, string> = {
        parentId: "parent_id",
        category: "category",
        domain: "domain",
        personId: "person_id",
        personName: "person_name",
        status: "status",
        note: "note",
        resolvedAt: "resolved_at",
      };
      const setClauses: string[] = [];
      const params: any[] = [];
      for (const key of allowed) {
        if (key in body) {
          setClauses.push(`${dbMap[key]}=?`);
          params.push(body[key]);
        }
      }
      if (setClauses.length === 0) {
        return res.json(toNode(existing));
      }
      params.push(req.params.nodeId);
      await adapter.run(`UPDATE support_node SET ${setClauses.join(", ")} WHERE id=?`, params);
      const updated = await adapter.queryOne<any>(`SELECT * FROM support_node WHERE id=?`, [req.params.nodeId]);
      log.info("support_node.update", { id: req.params.nodeId });
      res.json(toNode(updated));
    })
  );

  // DELETE /api/support-nodes/node/:nodeId
  r.delete(
    "/support-nodes/node/:nodeId",
    asyncHandler(async (req, res) => {
      const existing = await adapter.queryOne<any>(`SELECT * FROM support_node WHERE id=?`, [req.params.nodeId]);
      if (!existing) return res.status(404).json({ error: "not found" });
      const ids = await collectDescendants(adapter, req.params.nodeId);
      const placeholders = ids.map(() => "?").join(",");
      const result = await adapter.run(`DELETE FROM support_node WHERE id IN (${placeholders})`, ids);
      log.info("support_node.delete", { id: req.params.nodeId, deleted: result.changes });
      res.json({ deleted: result.changes });
    })
  );

  // GET /api/support-templates
  r.get(
    "/support-templates",
    asyncHandler(async (_req, res) => {
      const rows = await adapter.query<any>(`SELECT * FROM support_template ORDER BY usage_count DESC`);
      res.json(rows.map(toTemplate));
    })
  );

  // POST /api/support-templates
  r.post(
    "/support-templates",
    asyncHandler(async (req, res) => {
      const { name, description = "", nodes = [] } = req.body ?? {};
      if (!name) return res.status(400).json({ error: "name 为必填项" });

      const template: SupportTemplate = {
        id: randomUUID(),
        name,
        description,
        usageCount: 0,
        createdAt: new Date().toISOString(),
      };
      await adapter.run(
        `INSERT INTO support_template (id, name, description, usage_count, created_at) VALUES (?, ?, ?, ?, ?)`,
        [template.id, template.name, template.description, 0, template.createdAt]
      );

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
        await adapter.run(INSERT_NODE_SQL, [
          nodeId,
          null,
          template.id,
          parentId,
          n.category,
          n.domain,
          n.personId ?? null,
          n.personName ?? null,
          n.status ?? "待确认",
          n.note ?? "",
          now,
          null,
        ]);
        const row = await adapter.queryOne<any>(`SELECT * FROM support_node WHERE id=?`, [nodeId]);
        createdNodes.push(toNode(row));
      }
      log.info("support_template.create", { id: template.id, nodeCount: createdNodes.length });
      res.status(201).json({ template, nodes: createdNodes });
    })
  );

  // POST /api/support-templates/:templateId/apply/:ticketId
  r.post(
    "/support-templates/:templateId/apply/:ticketId",
    asyncHandler(async (req, res) => {
      const tmpl = await adapter.queryOne<any>(`SELECT * FROM support_template WHERE id=?`, [req.params.templateId]);
      if (!tmpl) return res.status(404).json({ error: "template not found" });

      const templateNodes = await adapter.query<any>(
        `SELECT * FROM support_node WHERE template_id=? AND ticket_id IS NULL ORDER BY created_at ASC`,
        [req.params.templateId]
      );

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
        await adapter.run(INSERT_NODE_SQL, [
          newId,
          req.params.ticketId,
          req.params.templateId,
          newParentId,
          n.category,
          n.domain,
          n.person_id ?? null,
          n.person_name ?? null,
          n.status,
          n.note,
          now,
          null,
        ]);
        const row = await adapter.queryOne<any>(`SELECT * FROM support_node WHERE id=?`, [newId]);
        cloned.push(toNode(row));
      }

      await adapter.run(`UPDATE support_template SET usage_count = usage_count + 1 WHERE id=?`, [
        req.params.templateId,
      ]);
      log.info("support_template.apply", {
        templateId: req.params.templateId,
        ticketId: req.params.ticketId,
        applied: cloned.length,
      });
      res.json({ applied: cloned.length, nodes: cloned });
    })
  );

  // DELETE /api/support-templates/:templateId
  r.delete(
    "/support-templates/:templateId",
    asyncHandler(async (req, res) => {
      const tmpl = await adapter.queryOne<any>(`SELECT * FROM support_template WHERE id=?`, [req.params.templateId]);
      if (!tmpl) return res.status(404).json({ error: "template not found" });

      const nodeResult = await adapter.run(`DELETE FROM support_node WHERE template_id=? AND ticket_id IS NULL`, [
        req.params.templateId,
      ]);
      await adapter.run(`DELETE FROM support_template WHERE id=?`, [req.params.templateId]);
      log.info("support_template.delete", { id: req.params.templateId, nodesDeleted: nodeResult.changes });
      res.json({ deleted: nodeResult.changes + 1 });
    })
  );

  return r;
}
