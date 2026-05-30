import { describe, it, expect } from "vitest";
import { parseDbUrl } from "../src/db.js";

describe("parseDbUrl", () => {
  it("defaults to sqlite when input is empty/undefined", () => {
    expect(parseDbUrl(undefined).kind).toBe("sqlite");
    expect(parseDbUrl("").kind).toBe("sqlite");
    expect(parseDbUrl("   ").kind).toBe("sqlite");
  });

  it("parses sqlite:// urls with relative paths", () => {
    const p = parseDbUrl("sqlite://./data/combat.db");
    expect(p.kind).toBe("sqlite");
    expect(p.sqlitePath).toBe("./data/combat.db");
  });

  it("parses sqlite:// urls with bare filenames", () => {
    const p = parseDbUrl("sqlite://combat.sqlite");
    expect(p.kind).toBe("sqlite");
    expect(p.sqlitePath).toBe("combat.sqlite");
  });

  it("treats bare paths as sqlite (backwards compat)", () => {
    const p = parseDbUrl("/opt/combat/data.sqlite");
    expect(p.kind).toBe("sqlite");
    expect(p.sqlitePath).toBe("/opt/combat/data.sqlite");
  });

  it("recognises postgres://", () => {
    const p = parseDbUrl("postgres://user:pwd@localhost:5432/combat");
    expect(p.kind).toBe("postgres");
    expect(p.raw).toBe("postgres://user:pwd@localhost:5432/combat");
  });

  it("recognises postgresql:// (alias)", () => {
    const p = parseDbUrl("postgresql://user@localhost/combat");
    expect(p.kind).toBe("postgres");
  });
});
