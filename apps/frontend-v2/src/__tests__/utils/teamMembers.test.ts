import { describe, it, expect } from "vitest";
import { parseMembers, syncMemberFields, buildMembersFromForm, type TeamMember } from "../../utils/teamMembers.js";

describe("teamMembers.parseMembers", () => {
  it("从 成员列表 JSON 字符串解析,角色非法时退回组员", () => {
    const props = {
      成员列表: JSON.stringify([
        { 姓名: "张三", 角色: "组长" },
        { 姓名: "李四", 角色: "组员" },
        { 姓名: "王五", 角色: "路人" }, // 非法角色 → 组员
      ]),
    };
    const r = parseMembers(props);
    expect(r).toEqual([
      { 姓名: "张三", 角色: "组长" },
      { 姓名: "李四", 角色: "组员" },
      { 姓名: "王五", 角色: "组员" },
    ]);
  });

  it("空姓名条目被过滤", () => {
    const props = {
      成员列表: JSON.stringify([
        { 姓名: "  ", 角色: "组员" },
        { 姓名: "张三", 角色: "组长" },
      ]),
    };
    expect(parseMembers(props).map((m) => m.姓名)).toEqual(["张三"]);
  });

  it("成员列表 不是合法 JSON → 回退 攻关组长/攻关成员 字符串拼装", () => {
    const props = {
      成员列表: "not-json",
      攻关组长: "张三",
      攻关成员: "李四,王五",
    };
    const r = parseMembers(props);
    expect(r).toEqual([
      { 姓名: "张三", 角色: "组长" },
      { 姓名: "李四", 角色: "组员" },
      { 姓名: "王五", 角色: "组员" },
    ]);
  });

  it("支持 数组直传(而非字符串)", () => {
    const props = {
      成员列表: [
        { 姓名: "李四", 角色: "组员" },
        { 姓名: "张三", 角色: "组长" },
      ],
    };
    expect(parseMembers(props)).toHaveLength(2);
  });

  it("攻关组长出现在 攻关成员 字符串中也不会重复", () => {
    const props = { 成员列表: "", 攻关组长: "张三", 攻关成员: "张三,李四" };
    const r = parseMembers(props);
    expect(r).toEqual([
      { 姓名: "张三", 角色: "组长" },
      { 姓名: "李四", 角色: "组员" },
    ]);
  });

  it("properties 为空/缺字段时返回 []", () => {
    expect(parseMembers(undefined)).toEqual([]);
    expect(parseMembers(null)).toEqual([]);
    expect(parseMembers({})).toEqual([]);
  });
});

describe("teamMembers.syncMemberFields", () => {
  it("生成 三字段一致:成员列表 JSON / 攻关组长 / 攻关成员 逗号串", () => {
    const members: TeamMember[] = [
      { 姓名: "张三", 角色: "组长" },
      { 姓名: "李四", 角色: "组员" },
      { 姓名: "王五", 角色: "组员" },
    ];
    const r = syncMemberFields(members);
    expect(r.攻关组长).toBe("张三");
    expect(r.攻关成员).toBe("张三,李四,王五");
    expect(JSON.parse(r.成员列表)).toEqual(members);
  });

  it("空成员 → 三字段全空", () => {
    const r = syncMemberFields([]);
    expect(r.攻关组长).toBe("");
    expect(r.攻关成员).toBe("");
    expect(r.成员列表).toBe("[]");
  });

  it("多个组长仅取第一个写入 攻关组长", () => {
    const r = syncMemberFields([
      { 姓名: "A", 角色: "组长" },
      { 姓名: "B", 角色: "组长" },
    ]);
    expect(r.攻关组长).toBe("A");
  });

  it("姓名前后空白被 trim", () => {
    const r = syncMemberFields([{ 姓名: "  张三  ", 角色: "组长" }]);
    expect(r.攻关组长).toBe("张三");
  });
});

describe("teamMembers.buildMembersFromForm", () => {
  it("leader + members 组合,去重(组长不会再出现在组员)", () => {
    const r = buildMembersFromForm("张三", ["张三", "李四"]);
    expect(r).toEqual([
      { 姓名: "张三", 角色: "组长" },
      { 姓名: "李四", 角色: "组员" },
    ]);
  });

  it("leader 为空时仅返回组员", () => {
    const r = buildMembersFromForm(undefined, ["李四", "王五"]);
    expect(r).toEqual([
      { 姓名: "李四", 角色: "组员" },
      { 姓名: "王五", 角色: "组员" },
    ]);
  });

  it("组员数组内重复条目被去重", () => {
    const r = buildMembersFromForm("A", ["B", "B", "C"]);
    expect(r.map((m) => m.姓名)).toEqual(["A", "B", "C"]);
  });
});
