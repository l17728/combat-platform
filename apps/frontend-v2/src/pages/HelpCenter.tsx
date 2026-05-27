import { useEffect, useState, useCallback } from 'react';
import {
  Typography,
  Table,
  Button,
  Space,
  Select,
  Drawer,
  Form,
  Input,
  message,
  Tag,
  Empty,
  Skeleton,
} from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import type { HelpRequest } from '../api.js';
import { HELP_STATUS_COLOR, PAGE_SIZE } from '../constants.js';
import { useSettings } from '../hooks/useSettings.js';
import type { GraphNode } from '@combat/shared';
import HelpButton from '../components/HelpButton.js';
import HELP from '../help-content.js';
import dayjs from 'dayjs';

const { Title, Text } = Typography;
const FALLBACK_CATEGORIES = ['环境', '领域专家', '团队协作', '资源'];
const FALLBACK_HELP_STATUS = ['待回复', '已回复'];

export default function HelpCenter() {
  const { getValues } = useSettings();
  const CATEGORY_OPTIONS = getValues('求助分类', FALLBACK_CATEGORIES);
  const HELP_STATUS_OPTIONS = getValues('求助中心状态', FALLBACK_HELP_STATUS);
  const [requests, setRequests] = useState<HelpRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [searchText, setSearchText] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [people, setPeople] = useState<GraphNode[]>([]);
  const [tickets, setTickets] = useState<GraphNode[]>([]);
  const navigate = useNavigate();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [list, ppl, tkt] = await Promise.all([
        api.listHelpRequests(statusFilter ? { status: statusFilter } : undefined),
        api.listNodes('person').catch(() => []),
        api.listNodes('attackTicket').catch(() => []),
      ]);
      setRequests(list);
      setPeople(ppl);
      setTickets(tkt);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filtered = searchText
    ? requests.filter((r) => {
        const s = searchText.toLowerCase();
        return (
          r.requesterName.toLowerCase().includes(s) ||
          (r.targetName ?? '').toLowerCase().includes(s) ||
          r.question.toLowerCase().includes(s) ||
          r.category.toLowerCase().includes(s)
        );
      })
    : requests;

  const handleSubmit = async (values: any) => {
    setSubmitting(true);
    try {
      await api.createHelpRequest({
        ticketId: values.ticketId,
        requesterName: values.requesterName,
        targetName: values.targetName,
        targetEmail: values.targetEmail,
        category: values.category,
        question: values.question,
        extraNote: values.extraNote,
      });
      message.success('求助已发送');
      setDrawerOpen(false);
      form.resetFields();
      fetchData();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const ticketOptions = tickets.map((t) => ({
    value: t.id,
    label: `${t.id.slice(0, 8)} ${(t.properties['标题'] as string) ?? ''}`,
  }));

  const personOptions = people.map((p) => ({
    value: (p.properties['姓名'] as string) ?? '',
    label: `${p.properties['姓名'] ?? p.id} (${p.properties['邮箱'] ?? '-'})`,
    email: (p.properties['邮箱'] as string) ?? '',
  }));

  const columns = [
    {
      title: '攻关单',
      dataIndex: 'ticketId',
      width: 100,
      render: (v: string) => (
        <a onClick={() => navigate(`/attack/${v}`)}>{v.slice(0, 8)}</a>
      ),
    },
    {
      title: '求助对象',
      width: 100,
      ellipsis: true,
      render: (_: unknown, r: HelpRequest) => r.targetName ?? r.targetEmail,
    },
    {
      title: '类型',
      dataIndex: 'category',
      width: 90,
    },
    {
      title: '内容摘要',
      dataIndex: 'question',
      ellipsis: true,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 80,
      render: (v: string) => <Tag color={HELP_STATUS_COLOR[v] ?? 'default'}>{v}</Tag>,
    },
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 100,
      render: (v: string) => dayjs(v).format('MM/DD HH:mm'),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>求助中心</Title>
        <Space>
          <HelpButton title={HELP.helpCenter.title} content={HELP.helpCenter.content} />
          <Button icon={<PlusOutlined />} type="primary" onClick={() => setDrawerOpen(true)}>
            发起求助
          </Button>
        </Space>
      </div>

      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          placeholder="状态筛选"
          allowClear
          style={{ width: 120 }}
          value={statusFilter}
          onChange={setStatusFilter}
          options={HELP_STATUS_OPTIONS.map((s) => ({ value: s, label: s }))}
        />
        <Input
          placeholder="搜索"
          prefix={<SearchOutlined />}
          style={{ width: 220 }}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          allowClear
        />
      </Space>

      {loading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : filtered.length === 0 ? (
        <Empty description="暂无求助记录" />
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
        title="发起求助"
        width={520}
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          form.resetFields();
        }}
        extra={
          <Button type="primary" loading={submitting} onClick={() => form.submit()}>
            发送求助邮件
          </Button>
        }
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="ticketId" label="关联攻关单" rules={[{ required: true }]}>
            <Select
              showSearch
              placeholder="搜索攻关单"
              options={ticketOptions}
              filterOption={(input, option) =>
                (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
              }
            />
          </Form.Item>
          <Form.Item name="requesterName" label="求助人" rules={[{ required: true }]}>
            <Select
              showSearch
              placeholder="您的姓名"
              options={personOptions.map((p) => ({ value: p.value, label: p.label }))}
              filterOption={(input, option) =>
                (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
              }
            />
          </Form.Item>
          <Form.Item name="targetName" label="求助对象（从名单选择）">
            <Select
              showSearch
              allowClear
              placeholder="从全员名单搜索"
              options={personOptions}
              filterOption={(input, option) =>
                (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
              }
              onChange={(val) => {
                const person = personOptions.find((p) => p.value === val);
                if (person?.email) form.setFieldValue('targetEmail', person.email);
              }}
            />
          </Form.Item>
          <Form.Item name="targetEmail" label="求助对象邮箱" rules={[{ required: true, type: 'email' }]}>
            <Input placeholder="email@example.com" />
          </Form.Item>
          <Form.Item name="category" label="求助类型" rules={[{ required: true }]}>
            <Select options={CATEGORY_OPTIONS.map((c) => ({ value: c, label: c }))} />
          </Form.Item>
          <Form.Item name="question" label="求助内容" rules={[{ required: true }]}>
            <Input.TextArea rows={4} placeholder="请描述您需要帮助的内容..." />
          </Form.Item>
          <Form.Item name="extraNote" label="附加说明">
            <Input.TextArea rows={2} placeholder="可选" />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  );
}
