import { useEffect, useState, useCallback } from 'react';
import {
  Table,
  Button,
  Space,
  Input,
  Select,
  Drawer,
  Form,
  message,
  Popconfirm,
  Tag,
  Typography,
  Skeleton,
} from 'antd';
import {
  PlusOutlined,
  ExportOutlined,
  UploadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { STATUS_COLOR, PAGE_SIZE } from '../constants.js';
import StatusTag from '../components/StatusTag.js';
import type { GraphNode, NodeSchema } from '@combat/shared';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const { Title } = Typography;

const STATUS_OPTIONS = ['待响应', '处理中', '进行中', '已解决', '已关闭'];

export default function AttackList() {
  const navigate = useNavigate();
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [schema, setSchema] = useState<NodeSchema | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [searchText, setSearchText] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [people, setPeople] = useState<GraphNode[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const filter: Record<string, string> = {};
      if (statusFilter) filter['状态'] = statusFilter;
      const [nodeList, schemaData] = await Promise.all([
        api.listNodes('attackTicket', filter),
        api.getSchema('attackTicket'),
      ]);
      setNodes(nodeList);
      setSchema(schemaData);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    api.listNodes('person').then(setPeople).catch(() => {});
  }, []);

  const filteredNodes = searchText
    ? nodes.filter((n) => {
        const p = n.properties;
        const s = searchText.toLowerCase();
        return (
          (p['标题'] as string)?.toLowerCase().includes(s) ||
          (p['问题单号'] as string)?.toLowerCase().includes(s) ||
          (p['当前处理人'] as string)?.toLowerCase().includes(s) ||
          (p['客户名称'] as string)?.toLowerCase().includes(s)
        );
      })
    : nodes;

  const personOptions = people.map((p) => ({
    value: (p.properties['姓名'] as string) ?? '',
    label: `${p.properties['姓名'] ?? p.id} (${p.properties['部门'] ?? '-'})`,
  }));

  const handleCreate = async (values: Record<string, unknown>) => {
    setSubmitting(true);
    try {
      const node = await api.createNode('attackTicket', values);
      message.success('创建成功');
      setDrawerOpen(false);
      form.resetFields();
      navigate(`/attack/${node.id}`);
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

  const handleExport = async () => {
    try {
      const blob = await api.exportNodes('attackTicket');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `攻关单_${dayjs().format('YYYYMMDD')}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      message.success('导出成功');
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const columns = [
    {
      title: '编号',
      width: 100,
      render: (_: unknown, r: GraphNode) => (
        <a onClick={() => navigate(`/attack/${r.id}`)}>{r.id.slice(0, 8)}</a>
      ),
    },
    {
      title: '标题',
      dataIndex: ['properties', '标题'],
      ellipsis: true,
      render: (text: string, r: GraphNode) => (
        <a onClick={() => navigate(`/attack/${r.id}`)}>{text || '-'}</a>
      ),
    },
    {
      title: '状态',
      dataIndex: ['properties', '状态'],
      width: 100,
      render: (v: string) => <StatusTag status={v} />,
    },
    {
      title: '处理人',
      dataIndex: ['properties', '当前处理人'],
      width: 100,
    },
    {
      title: '问题单号',
      dataIndex: ['properties', '问题单号'],
      width: 140,
      ellipsis: true,
    },
    {
      title: '客户',
      dataIndex: ['properties', '客户名称'],
      width: 120,
      ellipsis: true,
    },
    {
      title: '更新',
      dataIndex: 'updatedAt',
      width: 120,
      render: (v: string) => dayjs(v).fromNow(),
    },
    {
      title: '操作',
      width: 80,
      render: (_: unknown, r: GraphNode) => (
        <Space>
          <Popconfirm
            title={`确认删除「${r.properties['标题'] ?? r.id.slice(0, 8)}」？`}
            onConfirm={() => handleDelete(r.id)}
          >
            <a style={{ color: '#ff4d4f' }}>删除</a>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          攻关作战台
        </Title>
        <Space>
          <Button icon={<PlusOutlined />} type="primary" onClick={() => setDrawerOpen(true)}>
            新建攻关
          </Button>
          <Button icon={<ExportOutlined />} onClick={handleExport}>
            导出
          </Button>
        </Space>
      </div>

      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          placeholder="状态筛选"
          allowClear
          style={{ width: 140 }}
          value={statusFilter}
          onChange={setStatusFilter}
          options={STATUS_OPTIONS.map((s) => ({ value: s, label: s }))}
        />
        <Input
          placeholder="搜索标题/单号/处理人"
          prefix={<SearchOutlined />}
          style={{ width: 260 }}
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
          dataSource={filteredNodes}
          columns={columns}
          pagination={{ pageSize: PAGE_SIZE, showSizeChanger: false, showTotal: (t) => `共 ${t} 条` }}
          size="middle"
          onRow={(r) => ({
            onClick: (e) => {
              if ((e.target as HTMLElement).tagName !== 'A') navigate(`/attack/${r.id}`);
            },
            style: { cursor: 'pointer' },
          })}
        />
      )}

      <Drawer
        title="新建攻关任务"
        width={520}
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          form.resetFields();
        }}
        extra={
          <Button type="primary" loading={submitting} onClick={() => form.submit()}>
            创建
          </Button>
        }
      >
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="标题" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input placeholder="攻关任务标题" />
          </Form.Item>
          <Form.Item name="状态" label="状态" initialValue="待响应">
            <Select options={STATUS_OPTIONS.map((s) => ({ value: s, label: s }))} />
          </Form.Item>
          <Form.Item name="问题单号" label="问题单号">
            <Input placeholder="问题单号" />
          </Form.Item>
          <Form.Item name="事件单号" label="事件单号">
            <Input placeholder="事件单号" />
          </Form.Item>
          <Form.Item name="事件级别" label="事件级别">
            <Select
              allowClear
              placeholder="选择事件级别"
              options={['P1', 'P2', 'P3', 'P4', 'P4A', 'P4B'].map((v) => ({
                value: v,
                label: v,
              }))}
            />
          </Form.Item>
          <Form.Item name="客户名称" label="客户名称">
            <Input placeholder="客户名称" />
          </Form.Item>
          <Form.Item name="当前处理人" label="当前处理人">
            <Select
              showSearch
              allowClear
              placeholder="从全员名单搜索"
              options={personOptions}
              filterOption={(input, option) =>
                (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
              }
            />
          </Form.Item>
          <Form.Item name="攻关组长" label="攻关组长">
            <Select
              showSearch
              allowClear
              placeholder="从全员名单搜索"
              options={personOptions}
              filterOption={(input, option) =>
                (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
              }
            />
          </Form.Item>
          <Form.Item name="攻关申请人" label="攻关申请人">
            <Select
              showSearch
              allowClear
              placeholder="从全员名单搜索"
              options={personOptions}
              filterOption={(input, option) =>
                (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
              }
            />
          </Form.Item>
          <Form.Item name="影响及现存风险" label="影响及现存风险">
            <Input.TextArea rows={3} placeholder="描述影响及风险" />
          </Form.Item>
          <Form.Item name="资源ID" label="资源ID">
            <Input placeholder="资源ID" />
          </Form.Item>
          <Form.Item name="租户ID" label="租户ID">
            <Input placeholder="租户ID" />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  );
}
