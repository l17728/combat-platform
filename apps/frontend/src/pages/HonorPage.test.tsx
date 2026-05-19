import { describe, it, expect } from "vitest";
import { HonorPage } from "./HonorPage.js";
import { HomePage } from "./HomePage.js";
import { AppShell } from "./AppShell.js";
describe("honor/platform pages", () => {
  it("exports components", () => {
    expect(typeof HonorPage).toBe("function");
    expect(typeof HomePage).toBe("function");
    expect(typeof AppShell).toBe("function");
  });
});
