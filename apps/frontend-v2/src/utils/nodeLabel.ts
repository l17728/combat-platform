import { NODE_TYPE_LABEL } from '../constants.js';

interface NodeLike { nodeType: string; id?: string; properties?: Record<string, unknown> | null }

/**
 * 取实体可读名,**绝不返回数据库 UUID**(内部 id 用户无需看到)。
 * 无可读名时回退到中文类型名(如「人员」「团队贡献」)。
 */
export function nodeLabel(n: NodeLike): string {
  const p = n.properties ?? {};
  const v = p['标题'] ?? p['攻关单号'] ?? p['版本号'] ?? p['名称'] ?? p['姓名'] ?? p['name']
    ?? p['贡献人'] ?? p['组名'] ?? p['key'] ?? p['经验'] ?? p['问题说明'] ?? p['告警问题']
    ?? p['事件标题'] ?? p['事项描述'];
  if (v != null && String(v).trim()) return String(v);
  return NODE_TYPE_LABEL[n.nodeType] ?? n.nodeType ?? '记录';
}

/** 实体详情/关联全景路由。 */
export function detailPath(n: { nodeType: string; id: string }): string {
  return n.nodeType === 'attackTicket' ? `/attack/${n.id}` : `/related/${n.nodeType}/${n.id}`;
}
