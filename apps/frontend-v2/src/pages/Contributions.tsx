import { useEffect, useState, useCallback } from 'react';
import {
  Table,
  Button,
  Space,
  Select,
  Drawer,
  Form,
  Input,
  message,
  Popconfirm,
  Typography,
  Skeleton,
} from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { CONTRIBUTION_COLOR, PAGE_SIZE } from '../constants.js';
import StatusTag from '../components/StatusTag.js';
import type { GraphNode, NodeSchema } from '@combat/shared';
import dayjs from 'dayjs';

const { Title } = Typography;

export default function Contributions() {
  const navigate = useNavigate();
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [levelFilter, setLevelFilter] = useState<string | undefined>();
  const [searchText, setSearchText] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [people, setPeople] = useState<GraphNode[]>([]);
  const [tickets, setTickets] = useState<GraphNode[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const filter: Record<string, string> = {};
      if (levelFilter) filter['贡献等级'] = levelFilter;
      const [list, ppl, tkt] = await Promise.all([
        api.listNodes('contribution', filter),
        api.listNodes('person').catch(() => []),
        api.listNodes('attackTicket').catch(() => []),
      ]);
      setNodes(list);
      setPeople(ppl);
      setTickets(tkt);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [levelFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filtered = searchText
    ? nodes.filter((n) => {
        const p = n.properties;
        const s = searchText.toLowerCase();
        return (
          (p['贡献人'] as string)?.toLowerCase().includes(s) ||
          (p['描述'] as string)?.toLowerCase().includes(s)
        );
      })
    : nodes;

  const handleCreate = async (values: Record<string, unknown>) => {
    setSubmitting(true);
    try {
      await api.createNode('contribution', values);
      message.success('录入成功');
      setDrawerOpen(false);
      form.resetFields();
      fetchData();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteNode(id);
      message.success('删除成功');
      fetchData();
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const columns = [
    {
      title: '贡献人',
      dataIndex: ['properties', '贡献人'],
      width: 100,
      render: (v: string) => (
        <a onClick={() => navigate(`/honor/${encodeURIComponent(v)}`)}>{v || '-'}</a>
      ),
    },
    {
      title: '等级',
      dataIndex: ['properties', '贡献等级'],
      width: 80,
      render: (v: string) => <StatusTag status={v} type="contribution" />,
    },
    {
      title: '类型',
      dataIndex: ['properties', '贡献类型'],
      width: 80,
    },
    {
      title: '描述',
      dataIndex: ['properties', '描述'],
      ellipsis: true,
    },
    {
      title: '关联攻关单',
      dataIndex: ['properties', '关联攻关单'],
      width: 140,
      ellipsis: true,
    },
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 100,
      render: (v: string) => dayjs(v).format('MM/DD'),
    },
    {
      title: '操作',
      width: 60,
      render: (_: unknown, r: GraphNode) => (
        <Popconfirm title="确认删除此贡献？" onConfirm={() => handleDelete(r.id)}>
          <a style={{ color: '#ff4d4f' }}>删除</a>
        </Popconfirm>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          贡献录入
        </Title>
        <Button icon={<PlusOutlined />} type="primary" onClick={() => setDrawerOpen(true)}>
          录入贡献
        </Button>
      </div>

      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          placeholder="贡献等级"
          allowClear
          style={{ width: 120 }}
          value={levelFilter}
          onChange={setLevelFilter}
          options={['核心', '关键', '普通'].map((v) => ({ value: v, label: v }))}
        />
        <Input
          placeholder="搜索贡献人/描述"
          prefix={<SearchOutlined />}
          style={{ width: 220 }}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          allowClear
        />
      </Space>

      {loading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : (
        <Table
          rowKey="id"
          dataSource={filtered}
          columns={columns}
          pagination={{ pageSize: PAGE_SIZE, showSizeChanger: false, showTotal: (t) => `共 ${t} 条` }}
          size="middle"
        />
      )}

      <Drawer
        title="录入贡献"
        width={480}
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          form.resetFields();
        }}
        extra={
          <Button type="primary" loading={submitting} onClick={() => form.submit()}>
            提交
          </Button>
        }
      >
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="贡献人" label="贡献人" rules={[{ required: true }]}>
            <Select
              showSearch
              allowClear
              placeholder="从名单搜索"
              options={people.map((p) => ({
                value: (p.properties['姓名'] as string) ?? '',
                label: `${p.properties['姓名'] ?? p.id}`,
              }))}
              filterOption={(input, option) =>
                (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
              }
            />
          </Form.Item>
          <Form.Item name="贡献类型" label="贡献类型" rules={[{ required: true }]}>
            <Select
              placeholder="选择类型"
              options={['实施', '发现', '协调', '指导', '支持'].map((v) => ({
                value: v,
                label: v,
              }))}
            />
          </Form.Item>
          <Form.Item name="贡献等级" label="贡献等级" rules={[{ required: true }]}>
            <Select
              placeholder="选择等级"
              options={['核心', '关键', '普通'].map((v) => ({ value: v, label: v }))}
            />
          </Form.Item>
          <Form.Item name="描述" label="贡献描述" rules={[{ required: true }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="关联攻关单" label="关联攻关单">
            <Select
              showSearch
              allowClear
              placeholder="搜索攻关单"
              options={tickets.map((t) => ({
                value: (t.properties['标题'] as string) ?? t.id,
                label: `${t.id.slice(0, 8)} ${t.properties['标题'] ?? ''}`,
              }))}
              filterOption={(input, option) =>
                (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
              }
            />
          </Form.Item>
          <Form.Item name="周期" label="周期">
            <Input placeholder="例: 2026-Q2" />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  );
}
