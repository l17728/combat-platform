import { describe, it, expect } from "vitest";
import { AttackTable } from "./AttackTable.js";

describe("AttackTable", () => {
  it("is exported as a component function", () => {
    expect(typeof AttackTable).toBe("function");
  });
});
