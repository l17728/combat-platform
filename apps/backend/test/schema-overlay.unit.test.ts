import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSchemaDir, mergeSchemas, extractOverlay, ensureOverlayDir } from "../src/schema-overlay.js";
import { FileSchemaRegistry } from "../src/registry.js";
import type { NodeSchema } from "@combat/shared";

let tmp: string;
let baselineDir: string;
let overlayDir: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "schema-overlay-"));
  baselineDir = join(tmp, "baseline");
  overlayDir = join(tmp, "overlay");
  mkdirSync(baselineDir);
});

afterEach(() => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {}
});

function writeBaseline(file: string, schema: NodeSchema) {
  writeFileSync(join(baselineDir, file), JSON.stringify(schema));
}
function writeOverlay(file: string, schema: NodeSchema) {
  if (!existsSync(overlayDir)) mkdirSync(overlayDir);
  writeFileSync(join(overlayDir, file), JSON.stringify(schema));
}

describe("schema-overlay loadSchemaDir", () => {
  it("returns empty map for missing dir", () => {
    const r = loadSchemaDir(join(tmp, "nonexistent"));
    expect(r.byFile.size).toBe(0);
  });

  it("skips invalid json gracefully", () => {
    writeFileSync(join(baselineDir, "broken.json"), "{not json");
    writeBaseline("ok.json", {
      nodeType: "ok",
      label: "OK",
      identityKeys: [],
      derivedToKG: false,
      fields: [{ id: "a", name: "a", type: "string", label: "A" }],
    });
    const r = loadSchemaDir(baselineDir);
    expect(r.byFile.size).toBe(1);
    expect(r.byFile.has("ok.json")).toBe(true);
  });
});

describe("schema-overlay mergeSchemas", () => {
  it("baseline-only: every field gets source=baseline", () => {
    const baseline: NodeSchema[] = [
      {
        nodeType: "x",
        label: "X",
        identityKeys: [],
        derivedToKG: false,
        fields: [{ id: "a", name: "a", type: "string", label: "A" }],
      },
    ];
    const merged = mergeSchemas(baseline, []);
    expect(merged).toHaveLength(1);
    expect(merged[0].fields[0].source).toBe("baseline");
  });

  it("overlay adds new field → source=user, baseline field stays baseline", () => {
    const baseline: NodeSchema[] = [
      {
        nodeType: "x",
        label: "X",
        identityKeys: [],
        derivedToKG: false,
        fields: [{ id: "a", name: "a", type: "string", label: "A" }],
      },
    ];
    const overlay: NodeSchema[] = [
      {
        nodeType: "x",
        label: "X",
        identityKeys: [],
        derivedToKG: false,
        fields: [{ id: "b", name: "b", type: "string", label: "B" }],
      },
    ];
    const merged = mergeSchemas(baseline, overlay);
    expect(merged[0].fields).toHaveLength(2);
    const a = merged[0].fields.find((f) => f.name === "a");
    const b = merged[0].fields.find((f) => f.name === "b");
    expect(a?.source).toBe("baseline");
    expect(b?.source).toBe("user");
  });

  it("overlay overrides same-name field → source becomes user, value taken from overlay", () => {
    const baseline: NodeSchema[] = [
      {
        nodeType: "x",
        label: "X",
        identityKeys: [],
        derivedToKG: false,
        fields: [{ id: "a", name: "a", type: "string", label: "A baseline" }],
      },
    ];
    const overlay: NodeSchema[] = [
      {
        nodeType: "x",
        label: "X",
        identityKeys: [],
        derivedToKG: false,
        fields: [{ id: "a", name: "a", type: "string", label: "A user override" }],
      },
    ];
    const merged = mergeSchemas(baseline, overlay);
    expect(merged[0].fields).toHaveLength(1);
    expect(merged[0].fields[0].label).toBe("A user override");
    expect(merged[0].fields[0].source).toBe("user");
  });

  it("overlay nodeType not in baseline → user-defined table, all fields source=user", () => {
    const overlay: NodeSchema[] = [
      {
        nodeType: "userTable",
        label: "User",
        identityKeys: [],
        derivedToKG: false,
        fields: [{ id: "x", name: "x", type: "string", label: "X" }],
      },
    ];
    const merged = mergeSchemas([], overlay);
    expect(merged).toHaveLength(1);
    expect(merged[0].fields[0].source).toBe("user");
  });

  it("overlay does not override identityKeys / derivedToKG from baseline", () => {
    const baseline: NodeSchema[] = [
      {
        nodeType: "x",
        label: "X",
        identityKeys: ["id"],
        derivedToKG: true,
        fields: [],
      },
    ];
    const overlay: NodeSchema[] = [
      {
        nodeType: "x",
        label: "tampered",
        identityKeys: ["bogus"],
        derivedToKG: false,
        fields: [],
      },
    ];
    const merged = mergeSchemas(baseline, overlay);
    expect(merged[0].identityKeys).toEqual(["id"]);
    expect(merged[0].derivedToKG).toBe(true);
  });
});

describe("schema-overlay extractOverlay", () => {
  it("returns null when no user fields", () => {
    const ns: NodeSchema = {
      nodeType: "x",
      label: "X",
      identityKeys: [],
      derivedToKG: false,
      fields: [{ id: "a", name: "a", type: "string", label: "A", source: "baseline" }],
    };
    expect(extractOverlay(ns)).toBeNull();
  });

  it("returns user-only fields with source stripped", () => {
    const ns: NodeSchema = {
      nodeType: "x",
      label: "X",
      identityKeys: [],
      derivedToKG: false,
      fields: [
        { id: "a", name: "a", type: "string", label: "A", source: "baseline" },
        { id: "b", name: "b", type: "string", label: "B", source: "user" },
      ],
    };
    const ov = extractOverlay(ns)!;
    expect(ov.fields).toHaveLength(1);
    expect(ov.fields[0].name).toBe("b");
    expect(ov.fields[0]).not.toHaveProperty("source");
  });
});

describe("FileSchemaRegistry with overlayDir", () => {
  it("merges baseline + overlay on reload, addField writes to overlay only", () => {
    writeBaseline("x.json", {
      nodeType: "x",
      label: "X",
      identityKeys: [],
      derivedToKG: false,
      fields: [{ id: "a", name: "a", type: "string", label: "A" }],
    });
    ensureOverlayDir(overlayDir);
    const reg = new FileSchemaRegistry(baselineDir, overlayDir);
    let cfg = reg.getConfig();
    expect(cfg.nodeTypes).toHaveLength(1);
    expect(cfg.nodeTypes[0].fields[0].source).toBe("baseline");

    // addField → goes to overlay
    reg.applyFieldOp("x", {
      op: "addField",
      field: { name: "userField", type: "string", label: "User Field" } as any,
    } as any);

    // baseline file untouched
    const baselineRaw = JSON.parse(readFileSync(join(baselineDir, "x.json"), "utf8"));
    expect(baselineRaw.fields).toHaveLength(1);

    // overlay file created
    expect(existsSync(join(overlayDir, "x.json"))).toBe(true);
    const overlayRaw = JSON.parse(readFileSync(join(overlayDir, "x.json"), "utf8"));
    expect(overlayRaw.fields).toHaveLength(1);
    expect(overlayRaw.fields[0].name).toBe("userField");

    cfg = reg.getConfig();
    const merged = cfg.nodeTypes[0];
    expect(merged.fields).toHaveLength(2);
    const userF = merged.fields.find((f) => f.name === "userField");
    expect(userF?.source).toBe("user");
  });

  it("without overlayDir behaves like baseline-only legacy mode", () => {
    writeBaseline("x.json", {
      nodeType: "x",
      label: "X",
      identityKeys: [],
      derivedToKG: false,
      fields: [{ id: "a", name: "a", type: "string", label: "A" }],
    });
    const reg = new FileSchemaRegistry(baselineDir);
    const cfg = reg.getConfig();
    expect(cfg.nodeTypes[0].fields[0].source).toBeUndefined();
  });
});
