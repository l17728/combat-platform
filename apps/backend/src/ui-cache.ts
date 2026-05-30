import { Router } from "express";
import { randomUUID } from "node:crypto";
import type { Repository } from "@combat/shared";
import type { PinnedUi } from "@combat/shared";
import { log } from "./logger.js";

async function readPinned(repo: Repository): Promise<PinnedUi[]> {
  const raw = await repo.getSetting("ui_pinned");
  if (!raw) return [];
  try { return JSON.parse(raw) as PinnedUi[]; } catch { return []; }
}
async function writePinned(repo: Repository, pins: PinnedUi[]): Promise<void> {
  await repo.setSetting("ui_pinned", JSON.stringify(pins), "api");
}

export function makeUiCacheRouter(repo: Repository): Router {
  const r = Router();

  r.get("/ui-cache/pinned", async (_req, res) => {
    res.json(await readPinned(repo));
  });

  r.post("/ui-cache/pin", async (req, res) => {
    const { label, question, intent, uiSpec } = req.body ?? {};
    if (!uiSpec) return res.status(400).json({ error: "uiSpec 必填" });
    if (typeof uiSpec.widget !== "string" || typeof uiSpec.params !== "object" || uiSpec.params === null) {
      return res.status(400).json({ error: "uiSpec 格式非法（需含 widget:string 和 params:object）" });
    }
    if (!uiSpec.cacheKey) {
      return res.status(400).json({ error: "uiSpec.cacheKey 必填" });
    }
    const pin: PinnedUi = {
      id: randomUUID(),
      label: String(label || question || "未命名"),
      question: String(question || ""),
      intent: String(intent || "fallback-search"),
      uiSpec,
      pinnedAt: new Date().toISOString(),
    };
    const pins = await readPinned(repo);
    pins.unshift(pin);
    await writePinned(repo, pins.slice(0, 50));
    log.info("ui.pin", { id: pin.id, label: pin.label });
    res.status(201).json(pin);
  });

  r.patch("/ui-cache/pinned/:id", async (req, res) => {
    const pins = await readPinned(repo);
    const pin = pins.find(p => p.id === req.params.id);
    if (!pin) return res.status(404).json({ error: "not found" });
    if (req.body?.label) pin.label = String(req.body.label);
    await writePinned(repo, pins);
    log.info("ui.pin.rename", { id: req.params.id, label: pin.label });
    res.json(pin);
  });

  r.delete("/ui-cache/pinned/:id", async (req, res) => {
    const pins = (await readPinned(repo)).filter(p => p.id !== req.params.id);
    await writePinned(repo, pins);
    log.info("ui.unpin", { id: req.params.id });
    res.json({ ok: true });
  });

  return r;
}
