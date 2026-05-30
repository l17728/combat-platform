import { Router } from "express";
import type { DbAdapter } from "./db-adapter.js";
import { randomUUID } from "node:crypto";
import { log, asyncHandler } from "./logger.js";

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

export function makeDailyReportEntryRouter(adapter: DbAdapter): Router {
  const r = Router();

  // GET /api/nodes/:id/daily-reports
  r.get("/nodes/:id/daily-reports", asyncHandler(async (req, res) => {
    const rows = await adapter.query<any>(
      `SELECT * FROM daily_report_entry WHERE ticket_id=? ORDER BY created_at DESC`,
      [req.params.id],
    );
    res.json(rows.map(toEntry));
  }));

  // POST /api/nodes/:id/daily-reports
  r.post("/nodes/:id/daily-reports", asyncHandler(async (req, res) => {
    const { type = "进展通报", currentProgress = "", nextSteps = "", createdBy = "" } = req.body ?? {};
    if (!currentProgress.trim()) {
      return res.status(400).json({ error: "currentProgress 必填" });
    }
    const entry: DailyReportEntry = {
      id: randomUUID(), ticketId: req.params.id, type,
      currentProgress, nextSteps, status: "草稿",
      createdBy, createdAt: new Date().toISOString(), publishedAt: null,
    };
    await adapter.run(
      `INSERT INTO daily_report_entry (id, ticket_id, type, current_progress, next_steps, status, created_by, created_at, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.id, entry.ticketId, entry.type,
        entry.currentProgress, entry.nextSteps,
        entry.status, entry.createdBy,
        entry.createdAt, entry.publishedAt,
      ],
    );
    log.info("daily_report_entry.create", { ticketId: req.params.id, id: entry.id });
    res.status(201).json(entry);
  }));

  // PUT /api/nodes/:id/daily-reports/:eid — edit a draft entry; 已发布 后锁定不可改
  r.put("/nodes/:id/daily-reports/:eid", asyncHandler(async (req, res) => {
    const existing = await adapter.queryOne<any>(
      `SELECT * FROM daily_report_entry WHERE id=? AND ticket_id=?`,
      [req.params.eid, req.params.id],
    );
    if (!existing) return res.status(404).json({ error: "not found" });
    if (existing.status === "已发布") return res.status(400).json({ error: "已发布的日报不可编辑" });
    const { type, currentProgress, nextSteps } = req.body ?? {};
    if (currentProgress !== undefined && !String(currentProgress).trim()) {
      return res.status(400).json({ error: "currentProgress 不能为空" });
    }
    await adapter.run(
      `UPDATE daily_report_entry SET type=?, current_progress=?, next_steps=? WHERE id=?`,
      [
        type ?? existing.type,
        currentProgress ?? existing.current_progress,
        nextSteps ?? existing.next_steps,
        req.params.eid,
      ],
    );
    log.info("daily_report_entry.update", { ticketId: req.params.id, id: req.params.eid });
    const updated = await adapter.queryOne<any>(
      `SELECT * FROM daily_report_entry WHERE id=?`,
      [req.params.eid],
    );
    res.json(toEntry(updated));
  }));

  // POST /api/nodes/:id/daily-reports/:eid/publish
  r.post("/nodes/:id/daily-reports/:eid/publish", asyncHandler(async (req, res) => {
    const existing = await adapter.queryOne<any>(
      `SELECT * FROM daily_report_entry WHERE id=? AND ticket_id=?`,
      [req.params.eid, req.params.id],
    );
    if (!existing) return res.status(404).json({ error: "not found" });
    const publishedAt = new Date().toISOString();
    await adapter.run(
      `UPDATE daily_report_entry SET status='已发布', published_at=? WHERE id=?`,
      [publishedAt, req.params.eid],
    );
    log.info("daily_report_entry.publish", { ticketId: req.params.id, id: req.params.eid });
    res.json(toEntry({ ...existing, status: "已发布", published_at: publishedAt }));
  }));

  // DELETE /api/nodes/:id/daily-reports/:eid
  r.delete("/nodes/:id/daily-reports/:eid", asyncHandler(async (req, res) => {
    const result = await adapter.run(
      `DELETE FROM daily_report_entry WHERE id=? AND ticket_id=?`,
      [req.params.eid, req.params.id],
    );
    if (result.changes === 0) return res.status(404).json({ error: "not found" });
    log.info("daily_report_entry.delete", { ticketId: req.params.id, id: req.params.eid });
    res.status(204).send();
  }));

  return r;
}
