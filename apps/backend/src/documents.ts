import { Router } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync, createReadStream, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { DbAdapter } from "./db-adapter.js";
import { log, asyncHandler } from "./logger.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// Persistent uploads dir. In prod COMBAT_UPLOAD_DIR points under /opt/combat-v2/data/
// so files survive deploys (deploy rm -rf clears apps/, never data/).
function uploadDir(): string {
  const dir = process.env.COMBAT_UPLOAD_DIR || join(process.cwd(), "uploads");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function toDoc(r: any) {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    originalName: r.original_name ?? null,
    mimetype: r.mimetype ?? null,
    size: r.size ?? null,
    url: r.url ?? null,
    uploadedBy: r.uploaded_by ?? null,
    createdAt: r.created_at,
  };
}

function ensureTable(adapter: DbAdapter) {
  // SQLite-only DDL — Postgres path already provisioned by POSTGRES_SCHEMA_DDL.
  if (adapter.kind !== "sqlite") return;
  adapter.rawSqlite().exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      filename TEXT,
      original_name TEXT,
      mimetype TEXT,
      size INTEGER,
      url TEXT,
      uploaded_by TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_documents_created ON documents(created_at);
  `);
}

export function makeDocumentRouter(adapter: DbAdapter): Router {
  ensureTable(adapter);
  const r = Router();

  r.get(
    "/documents",
    asyncHandler(async (_req, res) => {
      const rows = await adapter.query<any>("SELECT * FROM documents ORDER BY created_at DESC");
      res.json(rows.map(toDoc));
    })
  );

  r.post(
    "/documents",
    upload.single("file"),
    asyncHandler(async (req, res) => {
      if (!req.file?.buffer) return res.status(400).json({ error: "file 必填（multipart 字段名应为 file）" });
      const id = randomUUID();
      const now = new Date().toISOString();
      // multer/busboy decodes the multipart filename as latin1, mojibake-ing
      // non-ASCII (Chinese) names. Re-decode the bytes as UTF-8 to recover them.
      const original = req.file.originalname
        ? Buffer.from(req.file.originalname, "latin1").toString("utf8")
        : "未命名文件";
      const name = (req.body?.name?.trim?.() || original) as string;
      const storedName = `${id}__${original}`;
      writeFileSync(join(uploadDir(), storedName), req.file.buffer);
      await adapter.run(
        `INSERT INTO documents (id, name, type, filename, original_name, mimetype, size, url, uploaded_by, created_at)
         VALUES (?, ?, 'file', ?, ?, ?, ?, NULL, ?, ?)`,
        [id, name, storedName, original, req.file.mimetype, req.file.size, req.body?.uploadedBy ?? null, now]
      );
      log.info("document.upload", { id, name, size: req.file.size });
      const row = await adapter.queryOne<any>("SELECT * FROM documents WHERE id=?", [id]);
      res.status(201).json(toDoc(row));
    })
  );

  r.post(
    "/documents/link",
    asyncHandler(async (req, res) => {
      const { name, url, uploadedBy } = req.body ?? {};
      if (!name || !url) return res.status(400).json({ error: "name, url 为必填项" });
      const id = randomUUID();
      const now = new Date().toISOString();
      await adapter.run(
        `INSERT INTO documents (id, name, type, url, uploaded_by, created_at)
       VALUES (?, ?, 'link', ?, ?, ?)`,
        [id, name, url, uploadedBy ?? null, now]
      );
      log.info("document.add_link", { id, name });
      const row = await adapter.queryOne<any>("SELECT * FROM documents WHERE id=?", [id]);
      res.status(201).json(toDoc(row));
    })
  );

  // Public (see auth.ts): clicked from MD-embedded links without a Bearer token.
  r.get(
    "/documents/:id/download",
    asyncHandler(async (req, res) => {
      const row = await adapter.queryOne<any>("SELECT * FROM documents WHERE id=?", [req.params.id]);
      if (!row) return res.status(404).json({ error: "未找到文档" });
      if (row.type === "link") return res.redirect(row.url);
      const fp = join(uploadDir(), row.filename);
      if (!existsSync(fp)) return res.status(404).json({ error: "文件不存在" });
      res.setHeader("Content-Type", row.mimetype || "application/octet-stream");
      res.setHeader(
        "Content-Disposition",
        `inline; filename*=UTF-8''${encodeURIComponent(row.original_name || row.name)}`
      );
      createReadStream(fp).pipe(res);
    })
  );

  r.delete(
    "/documents/:id",
    asyncHandler(async (req, res) => {
      const row = await adapter.queryOne<any>("SELECT * FROM documents WHERE id=?", [req.params.id]);
      if (!row) return res.status(404).json({ error: "未找到文档" });
      if (row.type === "file" && row.filename) {
        try {
          unlinkSync(join(uploadDir(), row.filename));
        } catch {
          /* file may be gone */
        }
      }
      await adapter.run("DELETE FROM documents WHERE id=?", [req.params.id]);
      log.info("document.delete", { id: req.params.id });
      res.json({ ok: true });
    })
  );

  return r;
}
