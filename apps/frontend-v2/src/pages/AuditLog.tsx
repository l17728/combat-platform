import { useEffect, useState } from 'react';
import { Typography, Table, Select, Space, Input, message, Skeleton, Tag, Tooltip, theme } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { api } from '../api.js';
import { PAGE_SIZE, PAGE_SIZE_OPTIONS, ACTION_COLOR, ACTION_LABEL, ENTITY_TYPE_LABEL, DATE_FORMAT_FULL } from '../constants.js';
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
      width: 110,
      render: (v: string) => <Tooltip title={dayjs(v).format(DATE_FORMAT_FULL)}>{dayjs(v).format('MM-DD HH:mm')}</Tooltip>,
    },
    {
      title: '操作人',
      dataIndex: 'performedBy',
      width: 80,
    },
    {
      title: '操作',
      dataIndex: 'action',
      width: 80,
      render: (v: string) => <Tag color={ACTION_COLOR[v]}>{ACTION_LABEL[v] || v}</Tag>,
    },
    {
      title: '实体类型',
      dataIndex: 'entityType',
      width: 90,
      render: (v: string) => ENTITY_TYPE_LABEL[v] || v,
    },
    {
      title: '实体ID',
      dataIndex: 'entityId',
      width: 80,
      render: (v: string) => <Tooltip title={v}><Tag>{v.slice(0, 8)}</Tag></Tooltip>,
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
        <Title level={4} style={{ margin: 0 }}>审计日志</Title>
        <Space>
          <HelpButton title={HELP.auditLog.title} content={HELP.auditLog.content} />
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
          scroll={{ x: 'max-content' }}
          pagination={{ pageSize: PAGE_SIZE, showSizeChanger: true, pageSizeOptions: PAGE_SIZE_OPTIONS, showTotal: (t) => `共 ${t} 条` }}
          size="middle"
        />
      )}
    </div>
  );
}
