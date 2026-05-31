// 私密攻关单访问判定 + 集合过滤,被 routes/list/export/audit/dashboard 复用。
// 单一真相源:仅当 attackTicket.私密 === '是' 时启用,授权范围:
//   - 创建人 (username,创建时注入)
//   - 成员列表 (姓名 JSON 数组)
//   - 私密授权人 (姓名 JSON 数组)
//   - 私密授权组 (组名 JSON 数组 → emailGroup 成员邮箱 → person.邮箱 → person.姓名)
// reqUser 缺失 (CLI / 测试 / COMBAT_NO_AUTH bypass) 时一律放行,与既有 list/dashboard 行为兼容。
import type { Repository, GraphNode } from "@combat/shared";

export interface ReqUserLike {
  username?: string;
  displayName?: string;
}

export function isPrivateTicket(node: { properties: Record<string, unknown> }): boolean {
  return String(node.properties?.["私密"] ?? "") === "是";
}

export async function canAccessPrivateAttackTicket(
  repo: Repository,
  node: { properties: Record<string, unknown> },
  user: ReqUserLike
): Promise<boolean> {
  const p = node.properties as Record<string, unknown>;
  const username = user.username || "";
  const displayName = user.displayName || "";
  if (String(p["创建人"] ?? "") === username && username) return true;
  const memberRaw = p["成员列表"];
  if (typeof memberRaw === "string" && memberRaw.trim()) {
    try {
      const arr = JSON.parse(memberRaw);
      if (Array.isArray(arr)) {
        for (const m of arr) {
          const n = String(m?.["姓名"] ?? "").trim();
          if (n && (n === displayName || n === username)) return true;
        }
      }
    } catch {
      /* fall through */
    }
  }
  const authRaw = p["私密授权人"];
  if (typeof authRaw === "string" && authRaw.trim()) {
    try {
      const arr = JSON.parse(authRaw);
      if (Array.isArray(arr)) {
        for (const n of arr) {
          const s = String(n).trim();
          if (s && (s === displayName || s === username)) return true;
        }
      }
    } catch {
      /* fall through */
    }
  }
  const groupRaw = p["私密授权组"];
  if (typeof groupRaw === "string" && groupRaw.trim()) {
    try {
      const groups = JSON.parse(groupRaw);
      if (Array.isArray(groups) && groups.length > 0) {
        for (const groupName of groups) {
          const gNodes = await repo.queryNodes("emailGroup", { 组名: String(groupName) });
          for (const g of gNodes) {
            const emails = String(g.properties?.["成员邮箱"] ?? "")
              .split(/[,，;；]/)
              .map((s) => s.trim())
              .filter(Boolean);
            for (const email of emails) {
              const persons = await repo.queryNodes("person", { 邮箱: email });
              for (const person of persons) {
                const n = String(person.properties?.["姓名"] ?? "").trim();
                if (n && (n === displayName || n === username)) return true;
              }
            }
          }
        }
      }
    } catch {
      /* fall through */
    }
  }
  return false;
}

// 集合过滤:保留所有非私密单 + 当前用户有权访问的私密单。
// reqUser 为空 (CLI / 内部调用 / COMBAT_NO_AUTH) → 全部放行。
export async function filterAccessibleTickets<T extends { properties: Record<string, unknown> }>(
  repo: Repository,
  tickets: T[],
  reqUser: ReqUserLike | undefined
): Promise<T[]> {
  if (!reqUser?.username) return tickets;
  const out: T[] = [];
  for (const t of tickets) {
    if (!isPrivateTicket(t)) {
      out.push(t);
      continue;
    }
    if (await canAccessPrivateAttackTicket(repo, t, reqUser)) {
      out.push(t);
    }
  }
  return out;
}

// 把一组可访问的 ticketId 集合算出来,审计/导出/dashboard 过滤"按 id 关联到的 attackTicket"时复用。
export async function getAccessibleTicketIds(
  repo: Repository,
  reqUser: ReqUserLike | undefined
): Promise<Set<string> | null> {
  if (!reqUser?.username) return null; // null = bypass (信任 CLI/测试)
  const all = (await repo.queryNodes("attackTicket")) as GraphNode[];
  const allowed = await filterAccessibleTickets(repo, all, reqUser);
  return new Set(allowed.map((t) => t.id));
}
