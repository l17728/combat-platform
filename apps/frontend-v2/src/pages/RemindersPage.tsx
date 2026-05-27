import { useState, useEffect, useCallback } from 'react';
import {
  Typography,
  Table,
  Tag,
  Space,
  Select,
  Button,
  Popconfirm,
  message,
  Empty,
  Tooltip,
  Drawer,
  Descriptions,
} from 'antd';
import { ScanOutlined, SendOutlined, StopOutlined, EyeOutlined } from '@ant-design/icons';
import { api } from '../api.js';
import type { Reminder } from '../api.js';
import { REMINDER_STATUS_COLOR, PAGE_SIZE, PAGE_SIZE_OPTIONS, DATE_FORMAT } from '../constants.js';
import HelpButton from '../components/HelpButton.js';
import HELP from '../help-content.js';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
dayjs.extend(relativeTime);

const { Title, Text, Paragraph } = Typography;

export default function RemindersPage() {
  const [data, setData] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string | undefined>('待发送');
  const [scanning, setScanning] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<Reminder | null>(null);

  const fetchData = useCallback(
    async (silent?: boolean) => {
      if (!silent) setLoading(true);
      try {
        const list = await api.listReminders(statusFilter);
        setData(list);
      } catch (e: any) {
        message.error(e.message);
      } finally {
        setLoading(false);
      }
    },
    [statusFilter],
  );

  useEffect(() => {
    fetchData();
  }, [statusFilter]);

  const handleScan = useCallback(async () => {
    setScanning(true);
    try {
      const res = await api.scanReminders();
      message.success(`扫描完成，新增 ${res.created} 条提醒`);
      fetchData();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setScanning(false);
    }
  }, [fetchData]);

  const handleSend = useCallback(
    async (id: string) => {
      try {
        await api.sendReminder(id, 'ui');
        message.success('已发送');
        fetchData();
      } catch (e: any) {
        message.error(e.message);
      }
    },
    [fetchData],
  );

  const handleIgnore = useCallback(
    async (id: string) => {
      try {
        await api.ignoreReminder(id, 'ui');
        message.success('已忽略');
        fetchData();
      } catch (e: any) {
        message.error(e.message);
      }
    },
    [fetchData],
  );

  const columns = [
    {
      title: '类型',
      dataIndex: 'kind',
      key: 'kind',
      width: 120,
      render: (t: string) => <Tag color="blue">{t}</Tag>,
    },
    {
      title: '收件人',
      dataIndex: 'recipientName',
      key: 'recipient',
      width: 100,
      ellipsis: true,
    },
    {
      title: '主题',
      dataIndex: 'subject',
      key: 'subject',
      ellipsis: true,
      render: (t: string, record: Reminder) => (
        <a onClick={() => { setDetail(record); setDetailOpen(true); }}>{t}</a>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 80,
      render: (s: string) => <Tag color={REMINDER_STATUS_COLOR[s]}>{s}</Tag>,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 100,
      sorter: (a: Reminder, b: Reminder) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      defaultSortOrder: 'descend' as const,
      render: (t: string) => (
        <Tooltip title={dayjs(t).format(DATE_FORMAT)}>
          <Text style={{ fontSize: 12 }}>{dayjs(t).fromNow()}</Text>
        </Tooltip>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 160,
      fixed: 'right' as const,
      render: (_: unknown, record: Reminder) => (
        <Space>
          <a onClick={() => { setDetail(record); setDetailOpen(true); }}>
            <EyeOutlined /> 查看
          </a>
          {record.status === '待发送' && (
            <>
              <Popconfirm title="确认发送？" onConfirm={() => handleSend(record.id)}>
                <a style={{ color: '#52c41a' }}>
                  <SendOutlined /> 发送
                </a>
              </Popconfirm>
              <Popconfirm title="确认忽略？" onConfirm={() => handleIgnore(record.id)}>
                <a style={{ color: '#ff4d4f' }}>
                  <StopOutlined /> 忽略
                </a>
              </Popconfirm>
            </>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          跟催提醒
        </Title>
        <Space>
          <HelpButton title={HELP.reminders.title} content={HELP.reminders.content} />
          <Select
            allowClear
            placeholder="状态筛选"
            style={{ width: 120 }}
            value={statusFilter}
            onChange={(v) => setStatusFilter(v)}
            options={[
              { value: '待发送', label: '待发送' },
              { value: '已发送', label: '已发送' },
              { value: '已忽略', label: '已忽略' },
            ]}
          />
          <Button icon={<ScanOutlined />} loading={scanning} onClick={handleScan}>
            扫描提醒
          </Button>
        </Space>
      </div>

      <Table
        rowKey="id"
        dataSource={data}
        columns={columns}
        loading={loading}
        size="middle"
        scroll={{ x: true }}
        pagination={{
          pageSize: PAGE_SIZE,
          showSizeChanger: true,
          pageSizeOptions: PAGE_SIZE_OPTIONS,
          showTotal: (t) => `共 ${t} 条`,
        }}
        locale={{ emptyText: <Empty description="暂无提醒" /> }}
      />

      <Drawer
        title="提醒详情"
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        width={560}
        destroyOnClose
        maskClosable={false}
      >
        {detail && (
          <Descriptions bordered size="small" column={1}>
            <Descriptions.Item label="类型">{detail.kind}</Descriptions.Item>
            <Descriptions.Item label="收件人">{detail.recipientName}</Descriptions.Item>
            <Descriptions.Item label="主题">{detail.subject}</Descriptions.Item>
            <Descriptions.Item label="状态">
              <Tag color={REMINDER_STATUS_COLOR[detail.status]}>{detail.status}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="内容">
              <Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{detail.body}</Paragraph>
            </Descriptions.Item>
            <Descriptions.Item label="创建时间">
              {dayjs(detail.createdAt).format(DATE_FORMAT)}
            </Descriptions.Item>
            {detail.decidedBy && (
              <Descriptions.Item label="处理人">{detail.decidedBy}</Descriptions.Item>
            )}
            {detail.decidedAt && (
              <Descriptions.Item label="处理时间">
                {dayjs(detail.decidedAt).format(DATE_FORMAT)}
              </Descriptions.Item>
            )}
          </Descriptions>
        )}
      </Drawer>
    </div>
  );
}
