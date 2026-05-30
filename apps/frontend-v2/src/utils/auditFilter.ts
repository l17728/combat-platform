// 攻关单审计日志过滤工具:只保留有业务沟通价值的关键事件
// 用于在「进展同步」Timeline 内联呈现关键审计 + 合规追溯卡片预览。

import type { AuditLogEntry } from '@combat/shared';

const KEY_FIELDS = new Set(['状态', '成员列表', '攻关组长', '攻关成员']);

export type AuditKind = '状态流转' | '升级' | '合并' | '成员变更';

export interface CategorizedAudit {
  kind: AuditKind;
  summary: string;
  color: string;     // antd Tag/Timeline 色
  entry: AuditLogEntry;
}

export function categorizeAudit(entry: AuditLogEntry): CategorizedAudit | null {
  if (entry.action === 'ESCALATE') {
    return { kind: '升级', color: 'orange', summary: '触发升级', entry };
  }
  if (entry.action === 'MERGE') {
    return { kind: '合并', color: 'gold', summary: '执行合并', entry };
  }
  if (entry.action === 'UPDATE' && entry.changes && typeof entry.changes === 'object') {
    const changes = entry.changes as Record<string, unknown>;
    if ('状态' in changes) {
      const c = changes['状态'] as any;
      const from = c?.from ?? '?';
      const to = c?.to ?? '?';
      return { kind: '状态流转', color: 'green', summary: `${from} → ${to}`, entry };
    }
    if (Object.keys(changes).some(k => KEY_FIELDS.has(k) && k !== '状态')) {
      return { kind: '成员变更', color: 'blue', summary: '成员/角色变动', entry };
    }
  }
  return null;
}

export function filterKeyAudits(entries: AuditLogEntry[]): CategorizedAudit[] {
  const result: CategorizedAudit[] = [];
  for (const e of entries) {
    const cat = categorizeAudit(e);
    if (cat) result.push(cat);
  }
  return result;
}
