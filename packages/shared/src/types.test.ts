import { describe, it, expect } from "vitest";
import type { EntitySchemaConfig, GraphNode, ProgressLog } from "./index.js";

describe("shared types", () => {
  it("EntitySchemaConfig shape compiles and is usable", () => {
    const cfg: EntitySchemaConfig = {
      version: 1,
      nodeTypes: [{
        nodeType: "attackTicket", label: "攻关单",
        identityKeys: ["攻关单号"], derivedToKG: true,
        fields: [{ name: "标题", type: "string", label: "标题", required: true }],
      }],
      edgeTypes: [{ edgeType: "ASSIGNED_TO", from: "attackTicket", to: "person" }],
    };
    expect(cfg.nodeTypes[0].fields[0].required).toBe(true);
  });
  it("GraphNode and ProgressLog carry JSON properties / sequence", () => {
    const n: GraphNode = { id: "1", nodeType: "attackTicket", properties: { 标题: "x" }, createdAt: "t", updatedAt: "t" };
    const p: ProgressLog = { id: "p1", ownerId: "1", seqNo: 1, content: "c", statusSnapshot: "进行中", updatedBy: "u", updatedAt: "t" };
    expect(n.properties["标题"]).toBe("x");
    expect(p.seqNo).toBe(1);
  });
});
