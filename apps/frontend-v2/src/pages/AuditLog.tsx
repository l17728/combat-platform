import { useEffect, useState } from 'react';
import { Typography, Table, Select, Space, Input, message, Skeleton, Tag, Tooltip, theme } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { api } from '../api.js';
import { PAGE_SIZE, PAGE_SIZE_OPTIONS, ACTION_COLOR, ACTION_LABEL, ENTITY_TYPE_LABEL, DATE_FORMAT_FULL } from '../constants.js';
import { nodeLabel } from '../utils/nodeLabel.js';
import type { AuditLogEntry } from '@combat/shared';
import HelpButton from '../components/HelpButton.js';
import HELP from '../help-content.js';
import dayjs from 'dayjs';

const { Title } = Typography;

export default function AuditLog() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState<string | undefined>();
  const [entityTypeFilter, setEntityTypeFilter] = useState<string | undefined>();
  const [entityNames, setEntityNames] = useState<Record<string, string>>({}); // id → 实体名称缓存
  const { token } = theme.useToken();

  const fetchLogs = async () => {
    setLoading(true);
    try {
      setLogs(await api.listAudit({ action: actionFilter, entityType: entityTypeFilter, limit: 200 }));
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLogs(); }, [actionFilter, entityTypeFilter]);

  // 按当前日志里 node 类型条目批量反查节点名,缓存复用;已删除显示「(已删除)」
  useEffect(() => {
    const need = new Set<string>();
    for (const l of logs) {
      if (l.entityType === 'node' && l.entityId && !(l.entityId in entityNames)) need.add(l.entityId);
    }
    if (need.size === 0) return;
    let cancelled = false;
    (async () => {
      const updates: Record<string, string> = {};
      await Promise.all([...need].map(async (id) => {
        try { const n = await api.getNode(id); updates[id] = nodeLabel(n); }
        catch { updates[id] = '(已删除)'; }
      }));
      if (!cancelled) setEntityNames((prev) => ({ ...prev, ...updates }));
    })();
    return () => { cancelled = true; };
  }, [logs]);

  const renderChanges = (v: unknown) => {
    if (!v || typeof v !== 'object') return '-';
    const entries = Object.entries(v as Record<string, any>);
    if (entries.length === 0) return '-';
    return (
      <Space size={4} wrap>
        {entries.map(([key, change]) => {
          if (typeof change === 'object' && change !== null && 'from' in change && 'to' in change) {
            return (
              <span key={key} style={{ fontSize: 12 }}>
                <Tag style={{ margin: 0 }}>{key}</Tag>
                <span style={{ color: token.colorTextSecondary }}>{String(change.from)}</span>
                <span style={{ margin: '0 4px' }}>→</span>
                <span style={{ color: token.colorPrimary }}>{String(change.to)}</span>
              </span>
            );
          }
          return <Tag key={key} style={{ margin: 0 }}>{key}: {JSON.stringify(change)}</Tag>;
        })}
      </Space>
    );
  };

  const columns = [
    {
      title: '时间',
      dataIndex: 'performedAt',
      width: 150,
      render: (v: string) => <Tooltip title={dayjs(v).format(DATE_FORMAT_FULL)}>{dayjs(v).format('MM-DD HH:mm')}</Tooltip>,
    },
    {
      title: '操作人',
      dataIndex: 'performedBy',
      width: 100,
      ellipsis: true,
    },
    {
      title: '操作',
      dataIndex: 'action',
      width: 90,
      render: (v: string) => <Tag color={ACTION_COLOR[v]}>{ACTION_LABEL[v] || v}</Tag>,
    },
    {
      title: '实体类型',
      dataIndex: 'entityType',
      width: 90,
      render: (v: string) => ENTITY_TYPE_LABEL[v] || v,
    },
    {
      title: '实体',
      dataIndex: 'entityId',
      width: 200,
      ellipsis: true,
      render: (id: string, row: AuditLogEntry) => {
        // 仅显示语义化名称;不再向用户暴露内部 UUID(技术追溯可通过浏览器开发工具或 changes 列查阅)
        if (row.entityType === 'node') {
          const nm = entityNames[id];
          return nm
            ? <Tooltip title={nm}><span>{nm}</span></Tooltip>
            : <Tag>(加载中)</Tag>;
        }
        return <Tag>{ENTITY_TYPE_LABEL[row.entityType] ?? row.entityType}</Tag>;
      },
    },
    {
      title: '变更详情',
      dataIndex: 'changes',
      ellipsis: true,
      render: renderChanges,
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Title level={4} style={{ margin: 0 }}>审计日志</Title>
          <HelpButton title={HELP.auditLog.title} content={HELP.auditLog.content} />
        </div>
        <Space>
          <span onClick={fetchLogs} style={{ cursor: 'pointer', color: token.colorPrimary }}><ReloadOutlined /> 刷新</span>
        </Space>
      </div>

      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          placeholder="操作类型"
          allowClear
          style={{ width: 140 }}
          value={actionFilter}
          onChange={setActionFilter}
          options={Object.entries(ACTION_LABEL).map(([v, label]) => ({ value: v, label }))}
        />
        <Select
          placeholder="实体类型"
          allowClear
          style={{ width: 140 }}
          value={entityTypeFilter}
          onChange={setEntityTypeFilter}
          options={Object.entries(ENTITY_TYPE_LABEL).map(([v, label]) => ({ value: v, label }))}
        />
      </Space>

      {loading ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : (
        <Table
          rowKey="id"
          dataSource={logs}
          columns={columns}
          pagination={{ pageSize: PAGE_SIZE, showSizeChanger: true, pageSizeOptions: PAGE_SIZE_OPTIONS, showTotal: (t) => `共 ${t} 条` }}
          size="middle"
        />
      )}
    </div>
  );
}
