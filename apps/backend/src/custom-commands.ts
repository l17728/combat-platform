import { Router } from "express";
import { randomUUID } from "node:crypto";
import type { Repository, CustomCommand } from "@combat/shared";
import { COMMANDS, parseArgs } from "./cli-core.js";

const KEY = "customCommands";

/** Extract `{param}` placeholders from a template, de-duplicated and order-preserving. */
export function extractParams(template: string): string[] {
  const out: string[] = [];
  for (const m of template.matchAll(/\{([^}]+)\}/g)) {
    const p = m[1].trim();
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}

function load(repo: Repository): CustomCommand[] {
  const raw = repo.getSetting(KEY);
  if (!raw) return [];
  try { return JSON.parse(raw) as CustomCommand[]; } catch { return []; }
}
function save(repo: Repository, list: CustomCommand[], actor: string) {
  repo.setSetting(KEY, JSON.stringify(list), actor);
}

export function makeCustomCommandsRouter(repo: Repository): Router {
  const r = Router();

  r.get("/commands", (_req, res) => res.json(load(repo)));

  r.post("/commands", (req, res) => {
    const name = String(req.body?.name ?? "").trim();
    const template = String(req.body?.template ?? "").trim();
    const description = req.body?.description != null ? String(req.body.description) : undefined;
    if (!name) return res.status(400).json({ error: "name 必填" });
    if (!template) return res.status(400).json({ error: "template 必填" });
    const first = template.split(/\s+/)[0];
    if (!COMMANDS.some(c => c.name === first))
      return res.status(400).json({ error: `template 首 token 非已知命令：${first}` });
    const cmd: CustomCommand = { id: randomUUID(), name, description, template,
      params: extractParams(template), createdAt: new Date().toISOString() };
    const list = load(repo); list.push(cmd); save(repo, list, "api");
    repo.logAudit({ action: "CUSTOM_COMMAND_CREATE", entityType: "setting", entityId: cmd.id, changes: { name, template }, actor: "api" });
    res.status(201).json(cmd);
  });

  r.delete("/commands/:id", (req, res) => {
    const list = load(repo);
    const idx = list.findIndex(c => c.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: "命令不存在" });
    const [removed] = list.splice(idx, 1);
    save(repo, list, "api");
    repo.logAudit({ action: "CUSTOM_COMMAND_DELETE", entityType: "setting", entityId: removed.id, changes: { name: removed.name }, actor: "api" });
    res.json({ ok: true });
  });

  r.post("/commands/:id/run", (req, res) => {
    const cmd = load(repo).find(c => c.id === req.params.id);
    if (!cmd) return res.status(404).json({ error: "命令不存在" });
    const args = (req.body?.args ?? {}) as Record<string, unknown>;
    const missing = cmd.params.filter(p => args[p] === undefined || args[p] === null || String(args[p]) === "");
    if (missing.length) return res.status(400).json({ error: `缺少参数：${missing.join(", ")}` });
    // substitute {p} → value, then parse + build the underlying CLI command's request
    const resolved = cmd.template.replace(/\{([^}]+)\}/g, (_, p) => String(args[String(p).trim()]));
    const [first, ...rest] = resolved.split(/\s+/);
    const def = COMMANDS.find(c => c.name === first);
    if (!def) return res.status(400).json({ error: `未知命令：${first}` });
    const { positional, opts } = parseArgs(rest);
    let request;
    try { request = def.build(positional, opts); }
    catch (e) { return res.status(400).json({ error: (e as Error).message }); }
    repo.logAudit({ action: "CUSTOM_COMMAND_RUN", entityType: "setting", entityId: cmd.id, changes: { resolved }, actor: "api" });
    res.json({ resolved, request });
  });

  return r;
}
