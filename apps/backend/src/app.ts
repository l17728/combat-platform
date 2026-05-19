import express from "express";
import type { Repository, SchemaRegistry } from "@combat/shared";
import { makeRouter } from "./routes.js";
import { makeImportRouter } from "./import.js";
import { makeHonorRouter } from "./honor.js";
import { makeExportRouter } from "./export.js";
import { makeRelatedRouter } from "./related.js";
import { makeProposalsRouter } from "./proposals.js";
import { makeQueryRouter } from "./query.js";

export function createApp(deps: { repo: Repository; registry: SchemaRegistry }) {
  const app = express();
  app.use(express.json());
  app.use("/api", makeRouter(deps.repo, deps.registry));
  app.use("/api", makeImportRouter(deps.repo, deps.registry));
  app.use("/api", makeHonorRouter(deps.repo));
  app.use("/api", makeExportRouter(deps.repo, deps.registry));
  app.use("/api", makeRelatedRouter(deps.repo));
  app.use("/api", makeProposalsRouter(deps.repo, deps.registry));
  app.use("/api", makeQueryRouter(deps.repo, deps.registry));
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: err.message });
  });
  return app;
}
