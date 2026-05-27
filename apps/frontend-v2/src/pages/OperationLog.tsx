import { useEffect, useState } from 'react';
import { Typography, Table, Select, Space, DatePicker, Tag, Tooltip, message, Skeleton, Button, Popconfirm, Input, Switch, theme } from 'antd';
import { ReloadOutlined, DeleteOutlined } from '@ant-design/icons';
import { api, type OpLogEntry } from '../api.js';
import { PAGE_SIZE, PAGE_SIZE_OPTIONS, DATE_FORMAT_FULL } from '../constants.js';
import { setEnabled, isEnabled } from '../utils/op-logger.js';
import { useAuth } from '../hooks/useAuth.js';
import dayjs from 'dayjs';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

const CATEGORY_COLOR: Record<string, string> = {
  api: 'blue',
  navigate: 'cyan',
  error: 'red',
  action: 'green',
};

const CATEGORY_LABEL: Record<string, string> = {
  api: 'API调用',
  navigate: '页面导航',
  error: '错误',
  action: '用户操作',
};

export default function OperationLog() {
  const [logs, setLogs] = useState<OpLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>();
  const [sessionIdFilter, setSessionIdFilter] = useState<string | undefined>();
  const [userNameFilter, setUserNameFilter] = useState<string | undefined>();
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null] | null>(null);
  const [trackingEnabled, setTrackingEnabled] = useState(isEnabled());
  const { isAdmin } = useAuth();
  const { token } = theme.useToken();

  useEffect(() => {
    api.getOpLogSettings().then(r => {
      setTrackingEnabled(r.enabled);
      setEnabled(r.enabled);
    }).catch(() => {});
  }, []);

  const handleToggle = async (v: boolean) => {
    try {
      await api.setOpLogSettings(v);
      setTrackingEnabled(v);
      setEnabled(v);
      message.success(v ? '操作追踪已开启' : '操作追踪已关闭');
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const fetchLogs = async (silent?: boolean) => {
    if (!silent) setLoading(true);
    try {
      const params: any = {
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      };
      if (categoryFilter) params.category = categoryFilter;
      if (sessionIdFilter) params.sessionId = sessionIdFilter;
      if (userNameFilter) params.userName = userNameFilter;
      if (dateRange?.[0]) params.from = dateRange[0].startOf('day').toISOString();
      if (dateRange?.[1]) params.to = dateRange[1].endOf('day').toISOString();
      const res = await api.listOpLogs(params);
      setLogs(res.rows);
      setTotal(res.total);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLogs(); }, [page, categoryFilter, sessionIdFilter, userNameFilter, dateRange]);

  const handleCleanup = async () => {
    try {
      const before = dayjs().subtract(30, 'day').toISOString();
      const res = await api.deleteOpLogs({ before });
      message.success(`已清理 ${res.deleted} 条旧记录`);
      fetchLogs();
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const handleCleanupSession = async () => {
    if (!sessionIdFilter) return;
    try {
      const res = await api.deleteOpLogs({ sessionId: sessionIdFilter });
      message.success(`已清理 ${res.deleted} 条记录`);
      setSessionIdFilter(undefined);
      fetchLogs();
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const renderDetail = (detail: string) => {
    try {
      const obj = JSON.parse(detail);
      return (
        <div style={{ fontSize: 12 }}>
          {Object.entries(obj).map(([k, v]) => (
            <div key={k}>
              <span style={{ color: token.colorTextSecondary }}>{k}:</span>{' '}
              <span style={{ wordBreak: 'break-all' }}>{String(v)}</span>
            </div>
          ))}
        </div>
      );
    } catch {
      return <span style={{ fontSize: 12 }}>{detail}</span>;
    }
  };

  const columns = [
    {
      title: '时间',
      dataIndex: 'timestamp',
      width: 150,
      sorter: (a: OpLogEntry, b: OpLogEntry) => a.timestamp.localeCompare(b.timestamp),
      defaultSortOrder: 'descend' as const,
      render: (v: string) => (
        <Tooltip title={dayjs(v).format(DATE_FORMAT_FULL)}>
          {dayjs(v).format('MM-DD HH:mm:ss')}
        </Tooltip>
      ),
    },
    {
      title: '用户',
      dataIndex: 'user_name',
      width: 100,
      ellipsis: true,
    },
    {
      title: '类别',
      dataIndex: 'category',
      width: 100,
      render: (v: string) => (
        <Tag color={CATEGORY_COLOR[v] || 'default'}>{CATEGORY_LABEL[v] || v}</Tag>
      ),
    },
    {
      title: '会话ID',
      dataIndex: 'session_id',
      width: 100,
      ellipsis: true,
      render: (v: string) => (
        <Tooltip title={v}>
          <a onClick={() => setSessionIdFilter(v)} style={{ fontSize: 12 }}>{v.slice(0, 8)}</a>
        </Tooltip>
      ),
    },
    {
      title: '详情',
      dataIndex: 'detail',
      ellipsis: true,
      render: renderDetail,
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>操作追踪</Title>
        <Space>
          {isAdmin && (
            <Space size={4}>
              <Text style={{ fontSize: 13 }}>追踪</Text>
              <Switch
                size="small"
                checked={trackingEnabled}
                onChange={handleToggle}
              />
            </Space>
          )}
          <Popconfirm title="确认清理30天前的记录？" onConfirm={handleCleanup}>
            <Button icon={<DeleteOutlined />} size="small">清理旧数据</Button>
          </Popconfirm>
          <span onClick={() => fetchLogs()} style={{ cursor: 'pointer', color: token.colorPrimary }}>
            <ReloadOutlined /> 刷新
          </span>
        </Space>
      </div>

      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          placeholder="类别"
          allowClear
          style={{ width: 120 }}
          value={categoryFilter}
          onChange={setCategoryFilter}
          options={Object.entries(CATEGORY_LABEL).map(([v, label]) => ({ value: v, label }))}
        />
        <Input
          placeholder="用户名"
          allowClear
          style={{ width: 120 }}
          value={userNameFilter}
          onChange={(e) => setUserNameFilter(e.target.value || undefined)}
        />
        {sessionIdFilter && (
          <Tag closable onClose={() => setSessionIdFilter(undefined)}>
            会话: {sessionIdFilter.slice(0, 8)}
            {sessionIdFilter && (
              <a onClick={handleCleanupSession} style={{ marginLeft: 8, color: '#ff4d4f', fontSize: 12 }}>清理此会话</a>
            )}
          </Tag>
        )}
        <RangePicker
          size="small"
          onChange={(dates) => setDateRange(dates as any)}
        />
      </Space>

      {!trackingEnabled && (
        <div style={{ marginBottom: 16, padding: '8px 12px', background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 6 }}>
          操作追踪当前已关闭，新操作不会被记录。管理员可在上方开关开启。
        </div>
      )}

      {loading ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : (
        <Table
          rowKey="id"
          dataSource={logs}
          columns={columns}
          size="middle"
          pagination={{
            current: page,
            pageSize: PAGE_SIZE,
            total,
            showSizeChanger: true,
            pageSizeOptions: PAGE_SIZE_OPTIONS,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p) => setPage(p),
          }}
        />
      )}
    </div>
  );
}
