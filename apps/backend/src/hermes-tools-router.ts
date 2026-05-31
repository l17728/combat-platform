// HTTP 暴露:
//   GET  /api/hermes/tools          → 列出所有工具 + 简介 + inputSchema
//   POST /api/hermes/tool/:name     → 调一个工具 {input}
//
// 鉴权:沿用 authMiddleware 设置的 req.user,工具内 ctx.user 走私单 gating。

import { Router } from "express";
import type { Repository, SchemaRegistry } from "@combat/shared";
import type { DbAdapter } from "./db-adapter.js";
import type { DB } from "./db.js";
import { asyncHandler } from "./logger.js";
import { ALL_TOOLS, callTool, type HermesToolCtx } from "./hermes-tools.js";

export function makeHermesToolsRouter(
  repo: Repository,
  registry: SchemaRegistry,
  adapter?: DbAdapter,
  db?: DB
): Router {
  const r = Router();

  r.get(
    "/hermes/tools",
    asyncHandler(async (_req, res) => {
      res.json({
        tools: ALL_TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });
    })
  );

  r.post(
    "/hermes/tool/:name",
    asyncHandler(async (req, res) => {
      const name = req.params.name;
      const input = req.body?.input ?? req.body ?? {};
      const ctx: HermesToolCtx = {
        repo,
        registry,
        adapter,
        db,
        user: (req as any).user,
      };
      const result = await callTool(name, input, ctx);
      if (!result.ok) {
        const status = result.error === "unknown_tool" ? 404 : 400;
        return res.status(status).json(result);
      }
      res.json(result);
    })
  );

  return r;
}
