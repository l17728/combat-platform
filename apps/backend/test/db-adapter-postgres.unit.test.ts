import { describe, it, expect, beforeEach, vi } from "vitest";
import { PostgresAdapter, rewritePlaceholders } from "../src/db-adapter.js";

// ---------------------------------------------------------------------------
// Pure rewritePlaceholders unit tests — no pg client needed
// ---------------------------------------------------------------------------

describe("rewritePlaceholders", () => {
  it("rewrites a single ? to $1", () => {
    expect(rewritePlaceholders("SELECT * FROM t WHERE id = ?")).toBe(
      "SELECT * FROM t WHERE id = $1",
    );
  });

  it("rewrites multiple ? to $1, $2, $3 in order", () => {
    expect(rewritePlaceholders("INSERT INTO t (a, b, c) VALUES (?, ?, ?)")).toBe(
      "INSERT INTO t (a, b, c) VALUES ($1, $2, $3)",
    );
  });

  it("leaves ? inside single-quoted string literals alone", () => {
    // The literal '?' must NOT be replaced; the outer ? in WHERE k = ? must be.
    const sql = "SELECT * FROM t WHERE note = '??' AND k = ?";
    expect(rewritePlaceholders(sql)).toBe(
      "SELECT * FROM t WHERE note = '??' AND k = $1",
    );
  });

  it("treats consecutive ? bound to params positionally", () => {
    const sql = "WHERE a = ? AND b = ? AND c = ?";
    expect(rewritePlaceholders(sql)).toBe("WHERE a = $1 AND b = $2 AND c = $3");
  });

  it("returns SQL unchanged when no placeholders are present", () => {
    expect(rewritePlaceholders("SELECT 1")).toBe("SELECT 1");
    expect(rewritePlaceholders("CREATE TABLE foo (id TEXT)")).toBe(
      "CREATE TABLE foo (id TEXT)",
    );
  });

  it("handles ? right after open paren / before comma without spacing issues", () => {
    expect(rewritePlaceholders("VALUES (?,?,?)")).toBe("VALUES ($1,$2,$3)");
  });

  it("toggles in/out of strings via apostrophes correctly", () => {
    // first '?' is inside, second ? outside (string closed by the apostrophe before AND)
    const sql = "WHERE label = 'x?y' AND k = ?";
    expect(rewritePlaceholders(sql)).toBe("WHERE label = 'x?y' AND k = $1");
  });

  it("preserves quoted strings containing many ? characters", () => {
    const sql = "SELECT '???' as a, ? as b";
    expect(rewritePlaceholders(sql)).toBe("SELECT '???' as a, $1 as b");
  });
});

// ---------------------------------------------------------------------------
// PostgresAdapter wiring tests — fake the pg.Pool interface
// ---------------------------------------------------------------------------

function makeMockPool() {
  return {
    query: vi.fn(async (_text: string, _params?: any[]) => ({
      rows: [{ ok: 1 }],
      rowCount: 1,
    })),
    connect: vi.fn(async () => {
      throw new Error("connect not used in this test");
    }),
  } as any;
}

describe("PostgresAdapter wiring", () => {
  let pool: ReturnType<typeof makeMockPool>;
  let adapter: PostgresAdapter;

  beforeEach(() => {
    pool = makeMockPool();
    adapter = new PostgresAdapter(pool);
  });

  it("kind is 'postgres'", () => {
    expect(adapter.kind).toBe("postgres");
  });

  it("query() rewrites ? to $n before calling pool.query", async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: "n1" }], rowCount: 1 });
    const rows = await adapter.query("SELECT id FROM nodes WHERE id = ? AND nodeType = ?", [
      "n1",
      "person",
    ]);
    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toBe("SELECT id FROM nodes WHERE id = $1 AND nodeType = $2");
    expect(params).toEqual(["n1", "person"]);
    expect(rows).toEqual([{ id: "n1" }]);
  });

  it("queryOne() returns the first row", async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: "a" }, { id: "b" }], rowCount: 2 });
    const row = await adapter.queryOne<{ id: string }>("SELECT id FROM t WHERE x = ?", ["v"]);
    expect(row).toEqual({ id: "a" });
    expect(pool.query.mock.calls[0][0]).toBe("SELECT id FROM t WHERE x = $1");
  });

  it("queryOne() returns undefined when no rows", async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const row = await adapter.queryOne("SELECT * FROM t WHERE id = ?", ["nope"]);
    expect(row).toBeUndefined();
  });

  it("run() returns { changes } using rowCount and rewrites placeholders", async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 3 });
    const r = await adapter.run("UPDATE t SET v = ? WHERE n > ?", ["nv", 0]);
    expect(r.changes).toBe(3);
    expect(pool.query.mock.calls[0][0]).toBe("UPDATE t SET v = $1 WHERE n > $2");
  });

  it("run() returns changes: 0 when rowCount is null", async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: null });
    const r = await adapter.run("DELETE FROM t WHERE k = ?", ["x"]);
    expect(r.changes).toBe(0);
  });

  it("exec() passes SQL through unchanged (no placeholders expected)", async () => {
    await adapter.exec("CREATE TABLE foo (id TEXT)");
    expect(pool.query).toHaveBeenCalledWith("CREATE TABLE foo (id TEXT)");
  });

  it("does NOT rewrite ? inside single-quoted SQL string literals", async () => {
    await adapter.query("SELECT * FROM t WHERE label = '??' AND k = ?", ["v"]);
    expect(pool.query.mock.calls[0][0]).toBe(
      "SELECT * FROM t WHERE label = '??' AND k = $1",
    );
  });

  it("rawSqlite() throws — Postgres path does not expose better-sqlite3", () => {
    expect(() => adapter.rawSqlite()).toThrow(/not supported on Postgres/i);
  });

  it("transaction() uses pool.connect, runs BEGIN/COMMIT, and releases client on success", async () => {
    const client = {
      query: vi.fn(async (_text: string, _params?: any[]) => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };
    pool.connect.mockResolvedValueOnce(client);

    const result = await adapter.transaction(async tx => {
      expect(tx.kind).toBe("postgres");
      await tx.run("INSERT INTO t VALUES (?)", [1]);
      return "ok";
    });

    expect(result).toBe("ok");
    // BEGIN + the INSERT + COMMIT
    const sqls = client.query.mock.calls.map(c => c[0]);
    expect(sqls[0]).toBe("BEGIN");
    expect(sqls[sqls.length - 1]).toBe("COMMIT");
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("transaction() runs ROLLBACK and re-raises when callback throws", async () => {
    const client = {
      query: vi.fn(async (_text: string, _params?: any[]) => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };
    pool.connect.mockResolvedValueOnce(client);

    const err = new Error("tx-fail");
    await expect(
      adapter.transaction(async () => {
        throw err;
      }),
    ).rejects.toBe(err);

    const sqls = client.query.mock.calls.map(c => c[0]);
    expect(sqls).toContain("BEGIN");
    expect(sqls).toContain("ROLLBACK");
    expect(sqls).not.toContain("COMMIT");
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("nested transaction() reuses the existing tx client (no extra BEGIN)", async () => {
    const client = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };
    pool.connect.mockResolvedValueOnce(client);

    await adapter.transaction(async outerTx => {
      // capture how many BEGINs ran before the inner call
      const beforeBegins = client.query.mock.calls.filter(c => c[0] === "BEGIN").length;
      await (outerTx as PostgresAdapter).transaction(async innerTx => {
        expect(innerTx.kind).toBe("postgres");
        await innerTx.run("SELECT ?", [1]);
      });
      const afterBegins = client.query.mock.calls.filter(c => c[0] === "BEGIN").length;
      // no new BEGIN issued for nested call
      expect(afterBegins).toBe(beforeBegins);
    });

    // exactly one COMMIT, one BEGIN total
    const sqls = client.query.mock.calls.map(c => c[0]);
    expect(sqls.filter(s => s === "BEGIN")).toHaveLength(1);
    expect(sqls.filter(s => s === "COMMIT")).toHaveLength(1);
  });
});
