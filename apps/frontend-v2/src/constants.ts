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

export const PROPOSAL_STATUS_COLOR: Record<string, string> = {
  '待审批': 'gold',
  '已通过': 'green',
  '已拒绝': 'red',
};

export const REMINDER_STATUS_COLOR: Record<string, string> = {
  '待发送': 'gold',
  '已发送': 'green',
  '已忽略': 'default',
};

export const REMINDER_KIND_LABEL: Record<string, string> = {
  '问题单跟催': '问题单跟催',
  'FE Deadline 提醒': 'FE Deadline 提醒',
  'CCB 提醒': 'CCB 提醒',
};

export const BUG_SEVERITY_COLOR: Record<string, string> = {
  '严重': 'red',
  '较高': 'orange',
  '一般': 'blue',
  '建议': 'default',
};

export const BUG_STATUS_COLOR: Record<string, string> = {
  '待处理': 'gold',
  '处理中': 'blue',
  '已解决': 'green',
  '已关闭': 'default',
};

export const NODE_TYPE_LABEL: Record<string, string> = {
  'attackTicket': '攻关单',
  'person': '人员',
  'contribution': '贡献',
  'teamContribution': '团队贡献',
  'releasePackage': '版本包',
  'weightFile': '权重文件',
  'infoCard': '信息卡片',
};

export const PAGE_SIZE = 20;
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

export const DATE_FORMAT = 'YYYY-MM-DD HH:mm';
export const DATE_FORMAT_FULL = 'YYYY-MM-DD HH:mm:ss';
export const DATE_FORMAT_SHORT = 'MM/DD HH:mm';

export const LINKABLE_NODE_TYPES: Record<string, string> = {
  'contribution': '贡献',
  'person': '人员',
  'releasePackage': '版本包',
  'weightFile': '权重文件',
};

export const LINKABLE_EDGE_TYPES: Record<string, string> = {
  'CONTRIBUTED_TO': '贡献关联',
  'ASSIGNED_TO': '负责关联',
  'ANCHORED_TO': '锚定关联',
};

export const TAB_TYPE_LABEL: Record<string, string> = {
  'link': '关联数据',
  'custom': '自定义笔记',
};

export const INFO_IMPORTANCE_COLOR: Record<string, string> = {
  '重要': 'red',
  '一般': 'orange',
  '普通': 'blue',
};

export const INFO_CATEGORY_COLOR: Record<string, string> = {
  '通知': 'blue',
  '公告': 'purple',
  '经验': 'cyan',
  '预警': 'red',
  '其他': 'default',
};
