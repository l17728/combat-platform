import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Table, Button, Space, Select, Drawer, Form, Input, message, Popconfirm, Typography, Skeleton, Divider, Tooltip, Tag,
} from 'antd';
import { PlusOutlined, SearchOutlined, ExportOutlined, EditOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { CONTRIBUTION_COLOR, PAGE_SIZE, PAGE_SIZE_OPTIONS } from '../constants.js';
import StatusTag from '../components/StatusTag.js';
import { useSettings } from '../hooks/useSettings.js';
import { useFlexTable, FlexHeaderCell } from '../hooks/useFlexTable.js';
import type { GraphNode } from '@combat/shared';
import HelpButton from '../components/HelpButton.js';
import HELP from '../help-content.js';
import dayjs from 'dayjs';

const { Title } = Typography;

export default function Contributions() {
  const navigate = useNavigate();
  const { getValues } = useSettings();
  const CONTRIB_TYPES = getValues('贡献类型', ['实施', '发现', '协调', '指导', '支持']);
  const CONTRIB_LEVELS = getValues('贡献等级', ['核心', '关键', '普通']);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [teamNodes, setTeamNodes] = useState<GraphNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [levelFilter, setLevelFilter] = useState<string | undefined>();
  const [searchText, setSearchText] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingNode, setEditingNode] = useState<GraphNode | null>(null);
  const [teamDrawerOpen, setTeamDrawerOpen] = useState(false);
  const [teamEditOpen, setTeamEditOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<GraphNode | null>(null);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const [teamForm] = Form.useForm();
  const [teamEditForm] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [teamSubmitting, setTeamSubmitting] = useState(false);
  const [teamEditSubmitting, setTeamEditSubmitting] = useState(false);
  const [people, setPeople] = useState<GraphNode[]>([]);
  const [tickets, setTickets] = useState<GraphNode[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const filter: Record<string, string> = {};
      if (levelFilter) filter['贡献等级'] = levelFilter;
      const [list, teamList, ppl, tkt] = await Promise.all([
        api.listNodes('contribution', filter),
        api.listNodes('teamContribution').catch(() => []),
        api.listNodes('person').catch(() => []),
        api.listNodes('attackTicket').catch(() => []),
      ]);
      setNodes(list);
      setTeamNodes(teamList);
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

  const handleCreateTeam = async (values: Record<string, unknown>) => {
    setTeamSubmitting(true);
    try {
      await api.createNode('teamContribution', values);
      message.success('录入成功');
      setTeamDrawerOpen(false);
      teamForm.resetFields();
      fetchData();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setTeamSubmitting(false);
    }
  };

  const handleEditTeam = async (values: Record<string, unknown>) => {
    if (!editingTeam) return;
    setTeamEditSubmitting(true);
    try {
      await api.updateNode(editingTeam.id, values);
      message.success('更新成功');
      setTeamEditOpen(false);
      setEditingTeam(null);
      fetchData();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setTeamEditSubmitting(false);
    }
  };

  const handleDeleteTeam = async (id: string) => {
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
    label: `${t.properties['标题'] ?? '(无标题)'}${t.properties['问题单号'] ? ` · ${t.properties['问题单号']}` : ''}`,
  }));

  const columns = [
    {
      key: '贡献人', title: '贡献人', dataIndex: ['properties', '贡献人'], width: 100, fixed: 'left' as const, ellipsis: true,
      render: (v: string) => <a onClick={() => navigate(`/honor/${encodeURIComponent(v)}`)}>{v || '-'}</a>,
      sorter: (a: GraphNode, b: GraphNode) => ((a.properties['贡献人'] as string) ?? '').localeCompare((b.properties['贡献人'] as string) ?? ''),
    },
    {
      key: '等级', title: '等级', dataIndex: ['properties', '贡献等级'], width: 80,
      render: (v: string) => <StatusTag status={v} type="contribution" />,
    },
    { key: '类型', title: '类型', dataIndex: ['properties', '贡献类型'], width: 80 },
    { key: '描述', title: '描述', dataIndex: ['properties', '描述'], ellipsis: true },
    {
      key: '关联攻关单', title: '关联攻关单', dataIndex: ['properties', '关联攻关单'], width: 140, ellipsis: true,
      render: (v: string) => {
        if (!v) return '--';
        const ticket = tickets.find(t => t.properties['标题'] === v);
        if (ticket) return <a onClick={() => navigate(`/attack/${ticket.id}`)}>{v}</a>;
        return v;
      },
    },
    { key: '周期', title: '周期', dataIndex: ['properties', '周期'], width: 80 },
    {
      key: '时间', title: '时间', dataIndex: 'createdAt', width: 80,
      render: (v: string) => <Tooltip title={dayjs(v).format('YYYY-MM-DD HH:mm')}>{dayjs(v).format('MM/DD')}</Tooltip>,
      sorter: (a: GraphNode, b: GraphNode) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      defaultSortOrder: 'descend' as const,
    },
    {
      key: '操作', title: '操作', width: 100, fixed: 'right' as const,
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

  const { columns: flexCols, FlexWrapper } = useFlexTable('contribution', columns);
  const tableComponents = useMemo(() => ({ header: { cell: FlexHeaderCell } }), []);

  const teamColumns = [
    {
      key: '团队名称', title: '团队名称', dataIndex: ['properties', '团队名称'], width: 140, fixed: 'left' as const, ellipsis: true,
      sorter: (a: GraphNode, b: GraphNode) => ((a.properties['团队名称'] as string) ?? '').localeCompare((b.properties['团队名称'] as string) ?? ''),
    },
    {
      key: '等级', title: '等级', dataIndex: ['properties', '贡献等级'], width: 80,
      render: (v: string) => <StatusTag status={v} type="contribution" />,
    },
    { key: '类型', title: '类型', dataIndex: ['properties', '贡献类型'], width: 80 },
    { key: '组长', title: '组长', dataIndex: ['properties', '组长'], width: 100, ellipsis: true },
    {
      key: '组员', title: '组员', dataIndex: ['properties', '组员'], ellipsis: true,
      render: (v: unknown) => {
        const members = Array.isArray(v) ? (v as string[]) : [];
        if (members.length === 0) return '--';
        return (
          <div>
            {members.map((m) => <Tag key={m} style={{ marginBottom: 2 }}>{m}</Tag>)}
          </div>
        );
      },
    },
    {
      key: '关联攻关单', title: '关联攻关单', dataIndex: ['properties', '关联攻关单'], width: 140, ellipsis: true,
      render: (v: string) => {
        if (!v) return '--';
        const ticket = tickets.find(t => t.properties['标题'] === v);
        if (ticket) return <a onClick={() => navigate(`/attack/${ticket.id}`)}>{v}</a>;
        return v;
      },
    },
    { key: '周期', title: '周期', dataIndex: ['properties', '周期'], width: 80 },
    {
      key: '时间', title: '时间', dataIndex: 'createdAt', width: 90,
      render: (v: string) => <Tooltip title={dayjs(v).format('YYYY-MM-DD HH:mm')}>{dayjs(v).format('MM/DD')}</Tooltip>,
      sorter: (a: GraphNode, b: GraphNode) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      defaultSortOrder: 'descend' as const,
    },
    {
      key: '操作', title: '操作', width: 100, fixed: 'right' as const,
      render: (_: unknown, r: GraphNode) => (
        <Space>
          <a onClick={() => { setEditingTeam(r); teamEditForm.setFieldsValue(r.properties as any); setTeamEditOpen(true); }}>编辑</a>
          <Popconfirm title="确认删除此团队贡献？" onConfirm={() => handleDeleteTeam(r.id)}>
            <a style={{ color: '#ff4d4f' }}>删除</a>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const { columns: teamFlexCols, FlexWrapper: TeamFlexWrapper } = useFlexTable('teamContribution', teamColumns);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Title level={4} style={{ margin: 0 }}>贡献录入</Title>
          <HelpButton title={HELP.contributions.title} content={HELP.contributions.content} />
        </div>
        <Space>
          <Button icon={<PlusOutlined />} type="primary" onClick={() => setDrawerOpen(true)}>录入个人贡献</Button>
          <Button icon={<PlusOutlined />} onClick={() => setTeamDrawerOpen(true)}>录入团队贡献</Button>
          <Button icon={<ExportOutlined />} onClick={handleExport}>导出</Button>
        </Space>
      </div>

      <Space style={{ marginBottom: 16 }} wrap>
        <Select placeholder="贡献等级" allowClear style={{ width: 120 }} value={levelFilter} onChange={setLevelFilter}
          options={CONTRIB_LEVELS.map((v) => ({ value: v, label: v }))} />
        <Input placeholder="搜索贡献人/描述" prefix={<SearchOutlined />} style={{ width: 220 }}
          value={searchText} onChange={(e) => setSearchText(e.target.value)} allowClear />
      </Space>

      <Divider orientation="left">个人贡献</Divider>
      {loading ? <Skeleton active paragraph={{ rows: 6 }} /> : (
        <FlexWrapper>
          <Table rowKey="id" dataSource={filtered} columns={flexCols}
            components={tableComponents}
            scroll={{ x: true }}
            pagination={{ pageSize: PAGE_SIZE, showSizeChanger: true, pageSizeOptions: PAGE_SIZE_OPTIONS, showTotal: (t) => `共 ${t} 条` }}
            size="middle" />
        </FlexWrapper>
      )}

      <Divider orientation="left">团队贡献</Divider>
      {loading ? <Skeleton active paragraph={{ rows: 4 }} /> : (
        <TeamFlexWrapper>
          <Table rowKey="id" dataSource={teamNodes} columns={teamFlexCols}
            components={tableComponents}
            scroll={{ x: true }}
            pagination={{ pageSize: PAGE_SIZE, showSizeChanger: true, pageSizeOptions: PAGE_SIZE_OPTIONS, showTotal: (t) => `共 ${t} 条` }}
            size="middle" />
        </TeamFlexWrapper>
      )}

      <Drawer title="录入个人贡献" width={480} open={drawerOpen} onClose={() => { setDrawerOpen(false); form.resetFields(); }} destroyOnClose maskClosable={false}
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

      <Drawer title="录入团队贡献" width={480} open={teamDrawerOpen} onClose={() => { setTeamDrawerOpen(false); teamForm.resetFields(); }} destroyOnClose maskClosable={false}
        extra={<Button type="primary" loading={teamSubmitting} onClick={() => teamForm.submit()}>提交</Button>}>
        <Form form={teamForm} layout="vertical" onFinish={handleCreateTeam}>
          <Divider orientation="left" orientationMargin={0}>团队信息</Divider>
          <Form.Item name="团队名称" label="团队名称" rules={[{ required: true, message: '请输入团队名称' }]}>
            <Input placeholder="团队名称" />
          </Form.Item>
          <Form.Item name="贡献类型" label="贡献类型">
            <Select placeholder="选择类型" options={CONTRIB_TYPES.map((v) => ({ value: v, label: v }))} />
          </Form.Item>
          <Form.Item name="贡献等级" label="贡献等级" rules={[{ required: true, message: '请选择等级' }]}>
            <Select placeholder="选择等级" options={CONTRIB_LEVELS.map((v) => ({ value: v, label: v }))} />
          </Form.Item>
          <Form.Item name="描述" label="贡献描述" rules={[{ required: true, message: '请输入描述' }]}>
            <Input.TextArea rows={3} placeholder="贡献描述" />
          </Form.Item>
          <Form.Item name="组长" label="组长">
            <Select showSearch allowClear placeholder="从名单搜索" options={personSelectOptions}
              filterOption={(input, option) => (option?.label as string)?.toLowerCase().includes(input.toLowerCase())} />
          </Form.Item>
          <Form.Item name="组员" label="组员">
            <Select mode="multiple" showSearch allowClear placeholder="从名单多选" options={personSelectOptions}
              filterOption={(input, option) => (option?.label as string)?.toLowerCase().includes(input.toLowerCase())} />
          </Form.Item>
          <Divider orientation="left" orientationMargin={0}>关联信息</Divider>
          <Form.Item name="关联攻关单" label="关联攻关单">
            <Select showSearch allowClear placeholder="搜索攻关单" options={ticketSelectOptions}
              filterOption={(input, option) => (option?.label as string)?.toLowerCase().includes(input.toLowerCase())} />
          </Form.Item>
          <Form.Item name="周期" label="周期"><Input placeholder="例: 2026-Q2" /></Form.Item>
        </Form>
      </Drawer>

      <Drawer title="编辑团队贡献" width={480} open={teamEditOpen} onClose={() => { setTeamEditOpen(false); setEditingTeam(null); }} destroyOnClose maskClosable={false}
        extra={<Button type="primary" loading={teamEditSubmitting} onClick={() => teamEditForm.submit()}>保存</Button>}>
        <Form form={teamEditForm} layout="vertical" onFinish={handleEditTeam}>
          <Divider orientation="left" orientationMargin={0}>团队信息</Divider>
          <Form.Item name="团队名称" label="团队名称" rules={[{ required: true, message: '请输入团队名称' }]}>
            <Input placeholder="团队名称" />
          </Form.Item>
          <Form.Item name="贡献类型" label="贡献类型">
            <Select placeholder="选择类型" options={CONTRIB_TYPES.map((v) => ({ value: v, label: v }))} />
          </Form.Item>
          <Form.Item name="贡献等级" label="贡献等级" rules={[{ required: true, message: '请选择等级' }]}>
            <Select placeholder="选择等级" options={CONTRIB_LEVELS.map((v) => ({ value: v, label: v }))} />
          </Form.Item>
          <Form.Item name="描述" label="贡献描述" rules={[{ required: true, message: '请输入描述' }]}>
            <Input.TextArea rows={3} placeholder="贡献描述" />
          </Form.Item>
          <Form.Item name="组长" label="组长">
            <Select showSearch allowClear placeholder="从名单搜索" options={personSelectOptions}
              filterOption={(input, option) => (option?.label as string)?.toLowerCase().includes(input.toLowerCase())} />
          </Form.Item>
          <Form.Item name="组员" label="组员">
            <Select mode="multiple" showSearch allowClear placeholder="从名单多选" options={personSelectOptions}
              filterOption={(input, option) => (option?.label as string)?.toLowerCase().includes(input.toLowerCase())} />
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
