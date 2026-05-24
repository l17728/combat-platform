export const STATUS_COLOR: Record<string, string> = {
  '待响应': 'gold',
  '处理中': 'blue',
  '进行中': 'cyan',
  '已解决': 'green',
  '已关闭': 'default',
};

export const STATUS_BAR_COLOR: Record<string, string> = {
  '待响应': '#d48806',
  '处理中': '#0050b3',
  '进行中': '#08979c',
  '已解决': '#389e0d',
  '已关闭': '#8c8c8c',
};

export const LEVEL_COLOR: Record<string, string> = {
  '高': 'red',
  '中': 'orange',
  '低': 'blue',
};

export const CONTRIBUTION_COLOR: Record<string, string> = {
  '核心': 'red',
  '关键': 'orange',
  '普通': 'blue',
};

export const HELP_STATUS_COLOR: Record<string, string> = {
  '待回复': 'gold',
  '已回复': 'green',
};

export const SUPPORT_STATUS_COLOR: Record<string, string> = {
  '待确认': 'default',
  '支持中': 'processing',
  '已完成': 'success',
  '已撤销': 'error',
};

export const ACTION_COLOR: Record<string, string> = {
  'CREATE': 'green',
  'UPDATE': 'blue',
  'DELETE': 'red',
  'PROGRESS': 'cyan',
  'SETTING': 'purple',
  'ESCALATE': 'orange',
  'MERGE': 'gold',
};

export const ACTION_LABEL: Record<string, string> = {
  'CREATE': '创建',
  'UPDATE': '更新',
  'DELETE': '删除',
  'PROGRESS': '进展',
  'SETTING': '设置',
  'ESCALATE': '升级',
  'MERGE': '合并',
};

export const ENTITY_TYPE_LABEL: Record<string, string> = {
  'node': '节点',
  'edge': '关系',
  'schema': '表结构',
  'setting': '设置',
  'proposal': '提案',
  'reminder': '提醒',
};

export const PAGE_SIZE = 20;
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

export const DATE_FORMAT = 'YYYY-MM-DD HH:mm';
export const DATE_FORMAT_FULL = 'YYYY-MM-DD HH:mm:ss';
export const DATE_FORMAT_SHORT = 'MM/DD HH:mm';
