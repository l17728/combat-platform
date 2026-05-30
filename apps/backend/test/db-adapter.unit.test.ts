import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { SqliteAdapter } from "../src/db-adapter.js";

let db: Database.Database;
let adapter: SqliteAdapter;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT, n INTEGER);
    CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
  `);
  adapter = new SqliteAdapter(db);
});

describe("SqliteAdapter", () => {
  describe("query<T>()", () => {
    it("returns an array of rows", async () => {
      db.prepare("INSERT INTO kv (k, v, n) VALUES (?, ?, ?)").run("a", "alpha", 1);
      db.prepare("INSERT INTO kv (k, v, n) VALUES (?, ?, ?)").run("b", "beta", 2);
      const rows = await adapter.query<{ k: string; v: string; n: number }>("SELECT * FROM kv ORDER BY k");
      expect(Array.isArray(rows)).toBe(true);
      expect(rows).toHaveLength(2);
      expect(rows[0].k).toBe("a");
      expect(rows[1].n).toBe(2);
    });

    it("returns an empty array when no rows match", async () => {
      const rows = await adapter.query("SELECT * FROM kv WHERE k = ?", ["nope"]);
      expect(rows).toEqual([]);
    });

    it("binds positional ? placeholders in given order", async () => {
      db.prepare("INSERT INTO kv (k, v, n) VALUES (?, ?, ?)").run("x", "X", 10);
      db.prepare("INSERT INTO kv (k, v, n) VALUES (?, ?, ?)").run("y", "Y", 20);
      db.prepare("INSERT INTO kv (k, v, n) VALUES (?, ?, ?)").run("z", "Z", 30);
      const rows = await adapter.query<{ k: string }>(
        "SELECT k FROM kv WHERE n IN (?, ?, ?) ORDER BY n",
        [10, 20, 30],
      );
      expect(rows.map(r => r.k)).toEqual(["x", "y", "z"]);
    });
  });

  describe("queryOne<T>()", () => {
    it("returns the first row when matches exist", async () => {
      db.prepare("INSERT INTO kv (k, v, n) VALUES (?, ?, ?)").run("a", "alpha", 1);
      db.prepare("INSERT INTO kv (k, v, n) VALUES (?, ?, ?)").run("b", "beta", 2);
      const row = await adapter.queryOne<{ k: string; n: number }>(
        "SELECT k, n FROM kv ORDER BY k",
      );
      expect(row?.k).toBe("a");
      expect(row?.n).toBe(1);
    });

    it("returns undefined when no rows match", async () => {
      const row = await adapter.queryOne("SELECT * FROM kv WHERE k = ?", ["missing"]);
      expect(row).toBeUndefined();
    });
  });

  describe("run()", () => {
    it("returns { changes, lastInsertRowid } for INSERT", async () => {
      const r = await adapter.run(
        "INSERT INTO items (name) VALUES (?)",
        ["first"],
      );
      expect(r.changes).toBe(1);
      expect(typeof r.lastInsertRowid === "number" || typeof r.lastInsertRowid === "bigint").toBe(true);
      // first row, autoincrement = 1
      expect(Number(r.lastInsertRowid)).toBe(1);
    });

    it("reports changes for UPDATE", async () => {
      db.prepare("INSERT INTO kv (k, v, n) VALUES (?, ?, ?)").run("a", "v1", 1);
      db.prepare("INSERT INTO kv (k, v, n) VALUES (?, ?, ?)").run("b", "v2", 2);
      const r = await adapter.run("UPDATE kv SET v = ? WHERE n > ?", ["nv", 0]);
      expect(r.changes).toBe(2);
    });

    it("reports 0 changes when DELETE matches nothing", async () => {
      const r = await adapter.run("DELETE FROM kv WHERE k = ?", ["nope"]);
      expect(r.changes).toBe(0);
    });
  });

  describe("exec()", () => {
    it("runs multi-statement DDL atomically", async () => {
      await adapter.exec(`
        CREATE TABLE a (id INTEGER PRIMARY KEY);
        CREATE TABLE b (id INTEGER PRIMARY KEY);
        INSERT INTO a (id) VALUES (1);
        INSERT INTO b (id) VALUES (2);
      `);
      const aRows = await adapter.query<{ id: number }>("SELECT id FROM a");
      const bRows = await adapter.query<{ id: number }>("SELECT id FROM b");
      expect(aRows).toEqual([{ id: 1 }]);
      expect(bRows).toEqual([{ id: 2 }]);
    });
  });

  describe("transaction()", () => {
    it("commits when the callback resolves", async () => {
      await adapter.transaction(async tx => {
        await tx.run("INSERT INTO items (name) VALUES (?)", ["committed"]);
      });
      const rows = await adapter.query<{ name: string }>("SELECT name FROM items");
      expect(rows).toEqual([{ name: "committed" }]);
    });

    it("rolls back when the callback throws", async () => {
      await expect(
        adapter.transaction(async tx => {
          await tx.run("INSERT INTO items (name) VALUES (?)", ["should-rollback"]);
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      const rows = await adapter.query("SELECT * FROM items");
      expect(rows).toEqual([]);
    });

    it("passes a DbAdapter to the callback (same kind)", async () => {
      let captured: any;
      await adapter.transaction(async tx => {
        captured = tx;
      });
      expect(captured.kind).toBe("sqlite");
      expect(typeof captured.query).toBe("function");
      expect(typeof captured.run).toBe("function");
    });

    it("re-raises the original error after rollback", async () => {
      const err = new Error("specific failure");
      await expect(
        adapter.transaction(async () => {
          throw err;
        }),
      ).rejects.toBe(err);
    });
  });

  describe("rawSqlite()", () => {
    it("returns the underlying better-sqlite3 Database", () => {
      const raw = adapter.rawSqlite();
      // duck-type: real better-sqlite3 instances expose `prepare`, `exec`, `pragma`
      expect(typeof raw.prepare).toBe("function");
      expect(typeof raw.exec).toBe("function");
      expect(typeof raw.pragma).toBe("function");
      // and it's the same handle we constructed with
      expect(raw).toBe(db);
    });
  });

  describe("kind", () => {
    it("is 'sqlite'", () => {
      expect(adapter.kind).toBe("sqlite");
    });
  });
});
