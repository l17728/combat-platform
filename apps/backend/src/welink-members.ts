// 后端版「成员管理」工具:与 apps/frontend-v2/src/utils/teamMembers.ts 同语义。
// 攻关单的「成员列表」(JSON)是真源;「攻关组长」「攻关成员」是派生字段。
// 任何成员维护都应通过 syncMemberFields 一致同步三方。

export type TeamRole = "组长" | "组员";

export interface TeamMember {
  姓名: string;
  角色: TeamRole;
}

const VALID_ROLES: TeamRole[] = ["组长", "组员"];

export function parseMembers(properties: Record<string, unknown> | undefined | null): TeamMember[] {
  if (!properties) return [];
  const raw = properties["成员列表"];
  if (typeof raw === "string" && raw.trim()) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        return arr
          .map((m: any) => ({
            姓名: typeof m?.姓名 === "string" ? m.姓名.trim() : "",
            角色: VALID_ROLES.includes(m?.角色) ? (m.角色 as TeamRole) : "组员",
          }))
          .filter((m) => m.姓名);
      }
    } catch { /* fall through */ }
  } else if (Array.isArray(raw)) {
    return (raw as any[])
      .map((m) => ({
        姓名: typeof m?.姓名 === "string" ? m.姓名.trim() : "",
        角色: VALID_ROLES.includes(m?.角色) ? (m.角色 as TeamRole) : "组员",
      }))
      .filter((m) => m.姓名);
  }
  // 老数据回退:从 攻关组长 / 攻关成员 字符串组装
  const result: TeamMember[] = [];
  const leader = (properties["攻关组长"] as string)?.trim();
  if (leader) result.push({ 姓名: leader, 角色: "组长" });
  const teamStr = (properties["攻关成员"] as string)?.trim();
  if (teamStr) {
    for (const n of teamStr.split(/[,，;；、\s]+/).map((s) => s.trim()).filter(Boolean)) {
      if (n !== leader) result.push({ 姓名: n, 角色: "组员" });
    }
  }
  return result;
}

export function syncMemberFields(members: TeamMember[]): {
  成员列表: string;
  攻关组长: string;
  攻关成员: string;
} {
  const cleaned = members.map((m) => ({ 姓名: m.姓名.trim(), 角色: m.角色 })).filter((m) => m.姓名);
  const leaders = cleaned.filter((m) => m.角色 === "组长").map((m) => m.姓名);
  const memberNames = cleaned.map((m) => m.姓名);
  return {
    成员列表: JSON.stringify(cleaned),
    攻关组长: leaders[0] || "",
    攻关成员: memberNames.join(","),
  };
}
