import { useEffect, useState, useCallback } from 'react';
import {
  Table, Button, Space, Select, Drawer, Form, Input, message, Popconfirm, Typography, Skeleton, Divider, Tooltip,
} from 'antd';
import { PlusOutlined, SearchOutlined, ExportOutlined, EditOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { CONTRIBUTION_COLOR, PAGE_SIZE, PAGE_SIZE_OPTIONS } from '../constants.js';
import StatusTag from '../components/StatusTag.js';
import { useSettings } from '../hooks/useSettings.js';
import type { GraphNode } from '@combat/shared';
import HelpButton from '../components/HelpButton.js';
import HELP from '../help-content.js';
import dayjs from 'dayjs';

const { Title } = Typography;
const FALLBACK_CONTRIB_TYPES = ['实施', '发现', '协调', '指导', '支持'];
const FALLBACK_CONTRIB_LEVELS = ['核心', '关键', '普通'];

export default function Contributions() {
  const navigate = useNavigate();
  const { getValues } = useSettings();
  const CONTRIB_TYPES = getValues('贡献类型', FALLBACK_CONTRIB_TYPES);
  const CONTRIB_LEVELS = getValues('贡献等级', FALLBACK_CONTRIB_LEVELS);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [levelFilter, setLevelFilter] = useState<string | undefined>();
  const [searchText, setSearchText] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingNode, setEditingNode] = useState<GraphNode | null>(null);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [editSubmitting, setEditSubmitting] = useState(false);
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

  const handleEdit = async (values: Record<string, unknown>) => {
    if (!editingNode) return;
    setEditSubmitting(true);
    try {
      await api.updateNode(editingNode.id, values);
      message.success('更新成功');
      setEditOpen(false);
      setEditingNode(null);
      fetchData();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setEditSubmitting(false);
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
      const b = await api.exportNodes('contribution');
      const u = URL.createObjectURL(b);
      const a = document.createElement('a');
      a.href = u; a.download = `贡献记录_${dayjs().format('YYYYMMDD')}.xlsx`; a.click();
      URL.revokeObjectURL(u);
      message.success('导出成功');
    } catch (e: any) { message.error(e.message); }
  };

  const personSelectOptions = people.map((p) => ({
    value: (p.properties['姓名'] as string) ?? '',
    label: `${p.properties['姓名'] ?? p.id} (${p.properties['部门'] ?? '-'})`,
  }));

  const ticketSelectOptions = tickets.map((t) => ({
    value: (t.properties['标题'] as string) ?? t.id,
    label: `${t.id.slice(0, 8)} ${t.properties['标题'] ?? ''}`,
  }));

  const columns = [
    {
      title: '贡献人', dataIndex: ['properties', '贡献人'], width: 100, fixed: 'left' as const,
      render: (v: string) => <a onClick={() => navigate(`/honor/${encodeURIComponent(v)}`)}>{v || '-'}</a>,
      sorter: (a: GraphNode, b: GraphNode) => ((a.properties['贡献人'] as string) ?? '').localeCompare((b.properties['贡献人'] as string) ?? ''),
    },
    {
      title: '等级', dataIndex: ['properties', '贡献等级'], width: 80,
      render: (v: string) => <StatusTag status={v} type="contribution" />,
    },
    { title: '类型', dataIndex: ['properties', '贡献类型'], width: 80 },
    { title: '描述', dataIndex: ['properties', '描述'], ellipsis: true },
    {
      title: '关联攻关单', dataIndex: ['properties', '关联攻关单'], width: 140, ellipsis: true,
      render: (v: string) => {
        if (!v) return '--';
        const ticket = tickets.find(t => t.properties['标题'] === v);
        if (ticket) return <a onClick={() => navigate(`/attack/${ticket.id}`)}>{v}</a>;
        return v;
      },
    },
    { title: '周期', dataIndex: ['properties', '周期'], width: 90 },
    {
      title: '时间', dataIndex: 'createdAt', width: 100,
      render: (v: string) => <Tooltip title={dayjs(v).format('YYYY-MM-DD HH:mm')}>{dayjs(v).format('MM/DD')}</Tooltip>,
      sorter: (a: GraphNode, b: GraphNode) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      defaultSortOrder: 'descend' as const,
    },
    {
      title: '操作', width: 100, fixed: 'right' as const,
      render: (_: unknown, r: GraphNode) => (
        <Space>
          <a onClick={() => { setEditingNode(r); editForm.setFieldsValue(r.properties as any); setEditOpen(true); }}>编辑</a>
          <Popconfirm title="确认删除此贡献？" onConfirm={() => handleDelete(r.id)}>
            <a style={{ color: '#ff4d4f' }}>删除</a>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>贡献录入</Title>
        <Space>
          <HelpButton title={HELP.contributions.title} content={HELP.contributions.content} />
          <Button icon={<PlusOutlined />} type="primary" onClick={() => setDrawerOpen(true)}>录入贡献</Button>
          <Button icon={<ExportOutlined />} onClick={handleExport}>导出</Button>
        </Space>
      </div>

      <Space style={{ marginBottom: 16 }} wrap>
        <Select placeholder="贡献等级" allowClear style={{ width: 120 }} value={levelFilter} onChange={setLevelFilter}
          options={CONTRIB_LEVELS.map((v) => ({ value: v, label: v }))} />
        <Input placeholder="搜索贡献人/描述" prefix={<SearchOutlined />} style={{ width: 220 }}
          value={searchText} onChange={(e) => setSearchText(e.target.value)} allowClear />
      </Space>

      {loading ? <Skeleton active paragraph={{ rows: 6 }} /> : (
        <Table rowKey="id" dataSource={filtered} columns={columns}
          scroll={{ x: 'max-content' }}
          pagination={{ pageSize: PAGE_SIZE, showSizeChanger: true, pageSizeOptions: PAGE_SIZE_OPTIONS, showTotal: (t) => `共 ${t} 条` }}
          size="middle" />
      )}

      <Drawer title="录入贡献" width={480} open={drawerOpen} onClose={() => { setDrawerOpen(false); form.resetFields(); }} destroyOnClose maskClosable={false}
        extra={<Button type="primary" loading={submitting} onClick={() => form.submit()}>提交</Button>}>
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="贡献人" label="贡献人" rules={[{ required: true, message: '请选择贡献人' }]}>
            <Select showSearch allowClear placeholder="从名单搜索" options={personSelectOptions}
              filterOption={(input, option) => (option?.label as string)?.toLowerCase().includes(input.toLowerCase())} />
          </Form.Item>
          <Divider orientation="left" orientationMargin={0}>贡献详情</Divider>
          <Form.Item name="贡献类型" label="贡献类型" rules={[{ required: true, message: '请选择类型' }]}>
            <Select placeholder="选择类型" options={CONTRIB_TYPES.map((v) => ({ value: v, label: v }))} />
          </Form.Item>
          <Form.Item name="贡献等级" label="贡献等级" rules={[{ required: true, message: '请选择等级' }]}>
            <Select placeholder="选择等级" options={CONTRIB_LEVELS.map((v) => ({ value: v, label: v }))} />
          </Form.Item>
          <Form.Item name="描述" label="贡献描述" rules={[{ required: true, message: '请输入描述' }]}>
            <Input.TextArea rows={3} placeholder="贡献描述" />
          </Form.Item>
          <Divider orientation="left" orientationMargin={0}>关联信息</Divider>
          <Form.Item name="关联攻关单" label="关联攻关单">
            <Select showSearch allowClear placeholder="搜索攻关单" options={ticketSelectOptions}
              filterOption={(input, option) => (option?.label as string)?.toLowerCase().includes(input.toLowerCase())} />
          </Form.Item>
          <Form.Item name="周期" label="周期"><Input placeholder="例: 2026-Q2" /></Form.Item>
        </Form>
      </Drawer>

      <Drawer title="编辑贡献" width={480} open={editOpen} onClose={() => { setEditOpen(false); setEditingNode(null); }} destroyOnClose maskClosable={false}
        extra={<Button type="primary" loading={editSubmitting} onClick={() => editForm.submit()}>保存</Button>}>
        <Form form={editForm} layout="vertical" onFinish={handleEdit}>
          <Form.Item name="贡献人" label="贡献人" rules={[{ required: true, message: '请选择贡献人' }]}>
            <Select showSearch allowClear placeholder="从名单搜索" options={personSelectOptions}
              filterOption={(input, option) => (option?.label as string)?.toLowerCase().includes(input.toLowerCase())} />
          </Form.Item>
          <Divider orientation="left" orientationMargin={0}>贡献详情</Divider>
          <Form.Item name="贡献类型" label="贡献类型" rules={[{ required: true, message: '请选择类型' }]}>
            <Select placeholder="选择类型" options={CONTRIB_TYPES.map((v) => ({ value: v, label: v }))} />
          </Form.Item>
          <Form.Item name="贡献等级" label="贡献等级">
            <Select placeholder="选择等级" options={CONTRIB_LEVELS.map((v) => ({ value: v, label: v }))} />
          </Form.Item>
          <Form.Item name="描述" label="贡献描述" rules={[{ required: true, message: '请输入描述' }]}>
            <Input.TextArea rows={3} placeholder="贡献描述" />
          </Form.Item>
          <Divider orientation="left" orientationMargin={0}>关联信息</Divider>
          <Form.Item name="关联攻关单" label="关联攻关单">
            <Select showSearch allowClear placeholder="搜索攻关单" options={ticketSelectOptions}
              filterOption={(input, option) => (option?.label as string)?.toLowerCase().includes(input.toLowerCase())} />
          </Form.Item>
          <Form.Item name="周期" label="周期"><Input placeholder="例: 2026-Q2" /></Form.Item>
        </Form>
      </Drawer>
    </div>
  );
}
