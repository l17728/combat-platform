import { describe, it, expect } from "vitest";
import { RelatedPage } from "./RelatedPage.js";
describe("RelatedPage", () => {
  it("is exported as a component function", () => {
    expect(typeof RelatedPage).toBe("function");
  });
});
