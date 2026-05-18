import express from "express";
import type { Repository, SchemaRegistry } from "@combat/shared";
import { makeRouter } from "./routes.js";
import { makeImportRouter } from "./import.js";

export function createApp(deps: { repo: Repository; registry: SchemaRegistry }) {
  const app = express();
  app.use(express.json());
  app.use("/api", makeRouter(deps.repo, deps.registry));
  app.use("/api", makeImportRouter(deps.repo, deps.registry));
  return app;
}
