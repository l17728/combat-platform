import { useEffect, useState } from 'react';
import { Typography, Table, Select, Space, Input, message, Skeleton } from 'antd';
import { api } from '../api.js';
import { PAGE_SIZE } from '../constants.js';
import type { AuditLogEntry } from '@combat/shared';
import dayjs from 'dayjs';

const { Title } = Typography;

export default function AuditLog() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState<string | undefined>();
  const [entityTypeFilter, setEntityTypeFilter] = useState<string | undefined>();

  useEffect(() => {
    setLoading(true);
    api
      .listAudit({ action: actionFilter, entityType: entityTypeFilter, limit: 200 })
      .then(setLogs)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [actionFilter, entityTypeFilter]);

  const columns = [
    {
      title: '时间',
      dataIndex: 'performedAt',
      width: 160,
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm:ss'),
    },
    {
      title: '操作人',
      dataIndex: 'performedBy',
      width: 100,
    },
    {
      title: '操作',
      dataIndex: 'action',
      width: 100,
    },
    {
      title: '实体类型',
      dataIndex: 'entityType',
      width: 120,
    },
    {
      title: '实体ID',
      dataIndex: 'entityId',
      width: 120,
      render: (v: string) => v.slice(0, 8),
    },
    {
      title: '变更详情',
      dataIndex: 'changes',
      ellipsis: true,
      render: (v: unknown) => (v ? JSON.stringify(v) : '-'),
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>
        审计日志
      </Title>

      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          placeholder="操作类型"
          allowClear
          style={{ width: 140 }}
          value={actionFilter}
          onChange={setActionFilter}
          options={['create', 'update', 'delete', 'transition', 'merge', 'import'].map((v) => ({
            value: v,
            label: v,
          }))}
        />
        <Select
          placeholder="实体类型"
          allowClear
          style={{ width: 140 }}
          value={entityTypeFilter}
          onChange={setEntityTypeFilter}
          options={['attackTicket', 'person', 'contribution', 'releasePackage', 'weightFile'].map(
            (v) => ({ value: v, label: v }),
          )}
        />
      </Space>

      {loading ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : (
        <Table
          rowKey="id"
          dataSource={logs}
          columns={columns}
          pagination={{ pageSize: PAGE_SIZE, showSizeChanger: false, showTotal: (t) => `共 ${t} 条` }}
          size="middle"
        />
      )}
    </div>
  );
}
