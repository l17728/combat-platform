import { Router } from "express";
import { randomUUID } from "node:crypto";
import type { Repository } from "@combat/shared";
import type { PinnedUi } from "@combat/shared";
import { log } from "./logger.js";

function readPinned(repo: Repository): PinnedUi[] {
  const raw = repo.getSetting("ui_pinned");
  if (!raw) return [];
  try { return JSON.parse(raw) as PinnedUi[]; } catch { return []; }
}
function writePinned(repo: Repository, pins: PinnedUi[]): void {
  repo.setSetting("ui_pinned", JSON.stringify(pins), "api");
}

export function makeUiCacheRouter(repo: Repository): Router {
  const r = Router();

  r.get("/ui-cache/pinned", (_req, res) => {
    res.json(readPinned(repo));
  });

  r.post("/ui-cache/pin", (req, res) => {
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
    const pins = readPinned(repo);
    pins.unshift(pin);
    writePinned(repo, pins.slice(0, 50));
    log.info("ui.pin", { id: pin.id, label: pin.label });
    res.status(201).json(pin);
  });

  r.patch("/ui-cache/pinned/:id", (req, res) => {
    const pins = readPinned(repo);
    const pin = pins.find(p => p.id === req.params.id);
    if (!pin) return res.status(404).json({ error: "not found" });
    if (req.body?.label) pin.label = String(req.body.label);
    writePinned(repo, pins);
    log.info("ui.pin.rename", { id: req.params.id, label: pin.label });
    res.json(pin);
  });

  r.delete("/ui-cache/pinned/:id", (req, res) => {
    const pins = readPinned(repo).filter(p => p.id !== req.params.id);
    writePinned(repo, pins);
    log.info("ui.unpin", { id: req.params.id });
    res.json({ ok: true });
  });

  return r;
}
