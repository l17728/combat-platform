import { describe, it, expect } from "vitest";
import { encodeJsonForAdapter, decodeJsonFromAdapter } from "../src/repository.js";
import type { DbAdapter } from "../src/db-adapter.js";

// Lightweight fake adapters — only `kind` matters for encode/decode logic.
const sqliteAdapter = { kind: "sqlite" } as unknown as DbAdapter;
const postgresAdapter = { kind: "postgres" } as unknown as DbAdapter;

describe("encodeJsonForAdapter", () => {
  describe("sqlite path", () => {
    it("serialises a plain object to a JSON string", () => {
      const out = encodeJsonForAdapter(sqliteAdapter, { a: 1, b: "two" });
      expect(typeof out).toBe("string");
      expect(JSON.parse(out as string)).toEqual({ a: 1, b: "two" });
    });

    it("serialises arrays", () => {
      const out = encodeJsonForAdapter(sqliteAdapter, [1, 2, 3]);
      expect(typeof out).toBe("string");
      expect(JSON.parse(out as string)).toEqual([1, 2, 3]);
    });

    it("converts null/undefined to '{}' (Phase 4 fallback)", () => {
      expect(encodeJsonForAdapter(sqliteAdapter, null)).toBe("{}");
      expect(encodeJsonForAdapter(sqliteAdapter, undefined)).toBe("{}");
    });

    it("serialises Chinese keys and values verbatim", () => {
      const out = encodeJsonForAdapter(sqliteAdapter, { 标题: "断连", 状态: "进行中" });
      expect(typeof out).toBe("string");
      const parsed = JSON.parse(out as string);
      expect(parsed.标题).toBe("断连");
      expect(parsed.状态).toBe("进行中");
    });

    it("serialises nested objects", () => {
      const nested = { a: { b: { c: [1, 2, 3] } }, list: [{ k: "v" }] };
      const out = encodeJsonForAdapter(sqliteAdapter, nested);
      expect(JSON.parse(out as string)).toEqual(nested);
    });
  });

  describe("postgres path", () => {
    it("passes the object through unchanged (pg driver handles jsonb)", () => {
      const obj = { a: 1, b: "two" };
      const out = encodeJsonForAdapter(postgresAdapter, obj);
      expect(out).toBe(obj);
    });

    it("passes arrays through unchanged", () => {
      const arr = [1, 2, 3];
      const out = encodeJsonForAdapter(postgresAdapter, arr);
      expect(out).toBe(arr);
    });

    it("passes null/undefined through unchanged (does NOT coerce to {})", () => {
      expect(encodeJsonForAdapter(postgresAdapter, null)).toBe(null);
      expect(encodeJsonForAdapter(postgresAdapter, undefined)).toBe(undefined);
    });

    it("preserves Chinese keys/values verbatim", () => {
      const obj = { 标题: "断连", 状态: "进行中" };
      const out = encodeJsonForAdapter(postgresAdapter, obj);
      expect(out).toBe(obj);
    });
  });
});

describe("decodeJsonFromAdapter", () => {
  describe("sqlite path", () => {
    it("parses a JSON string into an object", () => {
      const out = decodeJsonFromAdapter(sqliteAdapter, '{"a":1,"b":"two"}');
      expect(out).toEqual({ a: 1, b: "two" });
    });

    it("parses an array JSON string", () => {
      const out = decodeJsonFromAdapter(sqliteAdapter, "[1,2,3]");
      expect(out).toEqual([1, 2, 3]);
    });

    it("returns {} for null", () => {
      expect(decodeJsonFromAdapter(sqliteAdapter, null)).toEqual({});
    });

    it("returns {} for undefined", () => {
      expect(decodeJsonFromAdapter(sqliteAdapter, undefined)).toEqual({});
    });

    it("returns {} for invalid JSON (defensive)", () => {
      expect(decodeJsonFromAdapter(sqliteAdapter, "not json")).toEqual({});
    });

    it("passes a non-string value through (edge case from buggy historical data)", () => {
      // sqlite path normally only ever sees string — but the code defensively
      // returns the value untouched if it's not a string. Verify.
      const obj = { a: 1 };
      expect(decodeJsonFromAdapter(sqliteAdapter, obj)).toBe(obj);
    });
  });

  describe("postgres path", () => {
    it("returns objects as-is (pg already parsed jsonb)", () => {
      const obj = { a: 1, b: "two" };
      expect(decodeJsonFromAdapter(postgresAdapter, obj)).toBe(obj);
    });

    it("returns arrays as-is", () => {
      const arr = [1, 2, 3];
      expect(decodeJsonFromAdapter(postgresAdapter, arr)).toBe(arr);
    });

    it("returns {} for null/undefined", () => {
      expect(decodeJsonFromAdapter(postgresAdapter, null)).toEqual({});
      expect(decodeJsonFromAdapter(postgresAdapter, undefined)).toEqual({});
    });

    it("parses a string (defensive: migration window / raw text APIs)", () => {
      const out = decodeJsonFromAdapter(postgresAdapter, '{"a":1}');
      expect(out).toEqual({ a: 1 });
    });

    it("returns {} for invalid JSON string", () => {
      expect(decodeJsonFromAdapter(postgresAdapter, "not json")).toEqual({});
    });
  });
});

describe("encode/decode round-trip", () => {
  const cases: Array<[string, unknown]> = [
    ["plain object", { a: 1, b: "two" }],
    ["nested object", { a: { b: { c: 1 } }, arr: [{ k: "v" }] }],
    ["Chinese keys/values", { 标题: "断连", 状态: "进行中", 标签: ["紧急", "重点"] }],
    ["numeric array", [1, 2, 3, 4, 5]],
    ["mixed array", [1, "two", { three: 3 }, null]],
    ["empty object", {}],
    ["empty array", []],
  ];

  describe("sqlite", () => {
    for (const [name, input] of cases) {
      it(`round-trips ${name}`, () => {
        const encoded = encodeJsonForAdapter(sqliteAdapter, input);
        const decoded = decodeJsonFromAdapter(sqliteAdapter, encoded);
        expect(decoded).toEqual(input);
      });
    }
  });

  describe("postgres", () => {
    for (const [name, input] of cases) {
      it(`round-trips ${name}`, () => {
        const encoded = encodeJsonForAdapter(postgresAdapter, input);
        const decoded = decodeJsonFromAdapter(postgresAdapter, encoded);
        expect(decoded).toEqual(input);
      });
    }
  });
});
