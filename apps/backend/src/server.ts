import { join } from "node:path";
import { openDb } from "./db.js";
import { SqliteRepository } from "./repository.js";
import { FileSchemaRegistry } from "./registry.js";
import { createApp } from "./app.js";

const repo = new SqliteRepository(openDb(join(process.cwd(), "combat.sqlite")));
const registry = new FileSchemaRegistry(join(process.cwd(), "..", "..", "config", "schemas"));
createApp({ repo, registry }).listen(3001, () => console.log("backend on :3001"));
