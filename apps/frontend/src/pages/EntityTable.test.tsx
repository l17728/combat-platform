import { describe, it, expect } from "vitest";
import { EntityTable } from "./EntityTable.js";
describe("EntityTable", () => {
  it("is exported as a component function", () => {
    expect(typeof EntityTable).toBe("function");
  });
});
