import { Router } from "express";
import { randomUUID } from "node:crypto";
import type { Repository, CustomCommand } from "@combat/shared";
import { COMMANDS, parseArgs } from "./cli-core.js";
import { log } from "./logger.js";

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

async function load(repo: Repository): Promise<CustomCommand[]> {
  const raw = await repo.getSetting(KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as CustomCommand[];
  } catch {
    return [];
  }
}
async function save(repo: Repository, list: CustomCommand[], actor: string): Promise<void> {
  await repo.setSetting(KEY, JSON.stringify(list), actor);
}

export function makeCustomCommandsRouter(repo: Repository): Router {
  const r = Router();

  r.get("/commands", async (_req, res) => res.json(await load(repo)));

  r.post("/commands", async (req, res) => {
    const name = String(req.body?.name ?? "").trim();
    const template = String(req.body?.template ?? "").trim();
    const description = req.body?.description != null ? String(req.body.description) : undefined;
    if (!name) return res.status(400).json({ error: "name 必填" });
    if (!template) return res.status(400).json({ error: "template 必填" });
    const first = template.split(/\s+/)[0];
    if (!COMMANDS.some((c) => c.name === first))
      return res.status(400).json({ error: `template 首 token 非已知命令：${first}` });
    const cmd: CustomCommand = {
      id: randomUUID(),
      name,
      description,
      template,
      params: extractParams(template),
      createdAt: new Date().toISOString(),
    };
    const list = await load(repo);
    list.push(cmd);
    await save(repo, list, (req as any).user?.username ?? "api");
    await repo.logAudit({
      action: "CUSTOM_COMMAND_CREATE",
      entityType: "setting",
      entityId: cmd.id,
      changes: { name, template },
      actor: (req as any).user?.username ?? "api",
    });
    res.status(201).json(cmd);
  });

  r.delete("/commands/:id", async (req, res) => {
    const list = await load(repo);
    const idx = list.findIndex((c) => c.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: "命令不存在" });
    const [removed] = list.splice(idx, 1);
    await save(repo, list, (req as any).user?.username ?? "api");
    await repo.logAudit({
      action: "CUSTOM_COMMAND_DELETE",
      entityType: "setting",
      entityId: removed.id,
      changes: { name: removed.name },
      actor: (req as any).user?.username ?? "api",
    });
    res.json({ ok: true });
  });

  r.post("/commands/:id/run", async (req, res) => {
    const cmd = (await load(repo)).find((c) => c.id === req.params.id);
    if (!cmd) return res.status(404).json({ error: "命令不存在" });
    const args = (req.body?.args ?? {}) as Record<string, unknown>;
    const missing = cmd.params.filter((p) => args[p] === undefined || args[p] === null || String(args[p]) === "");
    if (missing.length) return res.status(400).json({ error: `缺少参数：${missing.join(", ")}` });
    // Tokenize the TEMPLATE first, then substitute {p} within each token — so a param
    // value containing spaces stays a single argument rather than being re-split.
    const tokens = cmd.template
      .split(/\s+/)
      .filter(Boolean)
      .map((tok) => tok.replace(/\{([^}]+)\}/g, (_, p) => String(args[String(p).trim()] ?? "")));
    const resolved = tokens.join(" ");
    const [first, ...rest] = tokens;
    const def = COMMANDS.find((c) => c.name === first);
    if (!def) {
      log.warn("command.run.unknown", { id: cmd.id, first });
      return res.status(400).json({ error: `未知命令：${first}` });
    }
    const { positional, opts } = parseArgs(rest);
    let request;
    try {
      request = def.build(positional, opts);
    } catch (e) {
      log.warn("command.run.build_fail", { id: cmd.id, error: (e as Error).message });
      return res.status(400).json({ error: (e as Error).message });
    }
    await repo.logAudit({
      action: "CUSTOM_COMMAND_RUN",
      entityType: "setting",
      entityId: cmd.id,
      changes: { resolved },
      actor: (req as any).user?.username ?? "api",
    });
    res.json({ resolved, request });
  });

  return r;
}
