import { Router } from "express";
import type { DB } from "./db.js";
import { randomUUID } from "node:crypto";
import { log } from "./logger.js";

export interface DailyReportEntry {
  id: string;
  ticketId: string;
  type: string;
  currentProgress: string;
  nextSteps: string;
  status: "草稿" | "已发布";
  createdBy: string;
  createdAt: string;
  publishedAt: string | null;
}

function toEntry(r: any): DailyReportEntry {
  return {
    id: r.id, ticketId: r.ticket_id, type: r.type,
    currentProgress: r.current_progress, nextSteps: r.next_steps,
    status: r.status, createdBy: r.created_by,
    createdAt: r.created_at, publishedAt: r.published_at ?? null,
  };
}

export function makeDailyReportEntryRouter(db: DB): Router {
  const r = Router();

  // GET /api/nodes/:id/daily-reports
  r.get("/nodes/:id/daily-reports", (req, res) => {
    const rows = db.prepare(
      `SELECT * FROM daily_report_entry WHERE ticket_id=? ORDER BY created_at DESC`
    ).all(req.params.id) as any[];
    res.json(rows.map(toEntry));
  });

  // POST /api/nodes/:id/daily-reports
  r.post("/nodes/:id/daily-reports", (req, res) => {
    const { type = "进展通报", currentProgress = "", nextSteps = "", createdBy = "" } = req.body ?? {};
    if (!currentProgress.trim()) {
      return res.status(400).json({ error: "currentProgress 必填" });
    }
    const entry: DailyReportEntry = {
      id: randomUUID(), ticketId: req.params.id, type,
      currentProgress, nextSteps, status: "草稿",
      createdBy, createdAt: new Date().toISOString(), publishedAt: null,
    };
    db.prepare(
      `INSERT INTO daily_report_entry VALUES (@id,@ticket_id,@type,@current_progress,@next_steps,@status,@created_by,@created_at,@published_at)`
    ).run({
      id: entry.id, ticket_id: entry.ticketId, type: entry.type,
      current_progress: entry.currentProgress, next_steps: entry.nextSteps,
      status: entry.status, created_by: entry.createdBy,
      created_at: entry.createdAt, published_at: entry.publishedAt,
    });
    log.info("daily_report_entry.create", { ticketId: req.params.id, id: entry.id });
    res.status(201).json(entry);
  });

  // PUT /api/nodes/:id/daily-reports/:eid — edit a draft entry; 已发布 后锁定不可改
  r.put("/nodes/:id/daily-reports/:eid", (req, res) => {
    const existing = db.prepare(`SELECT * FROM daily_report_entry WHERE id=? AND ticket_id=?`)
      .get(req.params.eid, req.params.id) as any;
    if (!existing) return res.status(404).json({ error: "not found" });
    if (existing.status === "已发布") return res.status(400).json({ error: "已发布的日报不可编辑" });
    const { type, currentProgress, nextSteps } = req.body ?? {};
    if (currentProgress !== undefined && !String(currentProgress).trim()) {
      return res.status(400).json({ error: "currentProgress 不能为空" });
    }
    db.prepare(`UPDATE daily_report_entry SET type=?, current_progress=?, next_steps=? WHERE id=?`).run(
      type ?? existing.type,
      currentProgress ?? existing.current_progress,
      nextSteps ?? existing.next_steps,
      req.params.eid,
    );
    log.info("daily_report_entry.update", { ticketId: req.params.id, id: req.params.eid });
    res.json(toEntry(db.prepare(`SELECT * FROM daily_report_entry WHERE id=?`).get(req.params.eid)));
  });

  // POST /api/nodes/:id/daily-reports/:eid/publish
  r.post("/nodes/:id/daily-reports/:eid/publish", (req, res) => {
    const existing = db.prepare(`SELECT * FROM daily_report_entry WHERE id=? AND ticket_id=?`)
      .get(req.params.eid, req.params.id) as any;
    if (!existing) return res.status(404).json({ error: "not found" });
    const publishedAt = new Date().toISOString();
    db.prepare(`UPDATE daily_report_entry SET status='已发布', published_at=? WHERE id=?`)
      .run(publishedAt, req.params.eid);
    log.info("daily_report_entry.publish", { ticketId: req.params.id, id: req.params.eid });
    res.json(toEntry({ ...existing, status: "已发布", published_at: publishedAt }));
  });

  // DELETE /api/nodes/:id/daily-reports/:eid
  r.delete("/nodes/:id/daily-reports/:eid", (req, res) => {
    const result = db.prepare(`DELETE FROM daily_report_entry WHERE id=? AND ticket_id=?`)
      .run(req.params.eid, req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: "not found" });
    log.info("daily_report_entry.delete", { ticketId: req.params.id, id: req.params.eid });
    res.status(204).send();
  });

  return r;
}
