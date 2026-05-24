import { useEffect, useState, useCallback } from 'react';
import {
  Typography,
  Button,
  Space,
  Card,
  Descriptions,
  Timeline,
  Drawer,
  Form,
  Input,
  Select,
  message,
  Popconfirm,
  Spin,
  Tag,
  Collapse,
  List,
  Avatar,
} from 'antd';
import {
  ArrowLeftOutlined,
  EditOutlined,
  SwapOutlined,
  PlusOutlined,
  UserOutlined,
  StarOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { STATUS_COLOR } from '../constants.js';
import StatusTag from '../components/StatusTag.js';
import type { GraphNode, ProgressLog, HelperRecommendation, AuditLogEntry } from '@combat/shared';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const { Title, Text, Paragraph } = Typography;
const STATUS_OPTIONS = ['待响应', '处理中', '进行中', '已解决', '已关闭'];

export default function AttackDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [node, setNode] = useState<GraphNode | null>(null);
  const [progress, setProgress] = useState<ProgressLog[]>([]);
  const [helpers, setHelpers] = useState<HelperRecommendation[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const [editOpen, setEditOpen] = useState(false);
  const [transitionOpen, setTransitionOpen] = useState(false);
  const [progressOpen, setProgressOpen] = useState(false);
  const [editForm] = Form.useForm();
  const [transForm] = Form.useForm();
  const [progForm] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [people, setPeople] = useState<GraphNode[]>([]);

  const fetchData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [n, p, h, a, ppl] = await Promise.all([
        api.getNode(id),
        api.listProgress(id),
        api.recommendHelpers(id, 5).catch(() => []),
        api.listAudit({ entityId: id, limit: 20 }).catch(() => []),
        api.listNodes('person').catch(() => []),
      ]);
      setNode(n);
      setProgress(p);
      setHelpers(h);
      setAuditLogs(a);
      setPeople(ppl);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading || !node) return <Spin size="large" style={{ display: 'block', marginTop: 100 }} />;

  const props = node.properties;
  const personOptions = people.map((p) => ({
    value: (p.properties['姓名'] as string) ?? '',
    label: `${p.properties['姓名'] ?? p.id} (${p.properties['部门'] ?? '-'})`,
  }));

  const handleEdit = async (values: Record<string, unknown>) => {
    if (!id) return;
    setSubmitting(true);
    try {
      await api.updateNode(id, values);
      message.success('更新成功');
      setEditOpen(false);
      fetchData();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleTransition = async (values: { toStatus: string; note?: string }) => {
    if (!id) return;
    setSubmitting(true);
    try {
      await api.transition(id, values.toStatus, values.note);
      message.success('状态流转成功');
      setTransitionOpen(false);
      transForm.resetFields();
      fetchData();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddProgress = async (values: { content: string }) => {
    if (!id) return;
    setSubmitting(true);
    try {
      await api.appendProgress(id, values.content, (props['状态'] as string) ?? '');
      message.success('进展已追加');
      setProgressOpen(false);
      progForm.resetFields();
      fetchData();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    try {
      await api.deleteNode(id);
      message.success('已删除');
      navigate('/attack');
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const fields = [
    { label: '问题单号', key: '问题单号' },
    { label: '事件单号', key: '事件单号' },
    { label: '事件级别', key: '事件级别' },
    { label: '客户名称', key: '客户名称' },
    { label: '当前处理人', key: '当前处理人' },
    { label: '攻关组长', key: '攻关组长' },
    { label: '攻关申请人', key: '攻关申请人' },
    { label: '资源ID', key: '资源ID' },
    { label: '租户ID', key: '租户ID' },
    { label: '局点', key: '局点' },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Button type="link" icon={<ArrowLeftOutlined />} onClick={() => navigate('/attack')}>
          返回列表
        </Button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>
            {(props['标题'] as string) ?? id!.slice(0, 8)}{' '}
            <StatusTag status={(props['状态'] as string) ?? ''} />
          </Title>
          <Text type="secondary">
            创建于 {dayjs(node.createdAt).format('YYYY-MM-DD HH:mm')} · 更新于 {dayjs(node.updatedAt).fromNow()}
          </Text>
        </div>
        <Space>
          <Button icon={<SwapOutlined />} onClick={() => setTransitionOpen(true)}>
            状态流转
          </Button>
          <Button icon={<EditOutlined />} onClick={() => {
            editForm.setFieldsValue(props as any);
            setEditOpen(true);
          }}>
            编辑信息
          </Button>
          <Popconfirm title="确认删除此攻关单？" onConfirm={handleDelete}>
            <Button danger>删除</Button>
          </Popconfirm>
        </Space>
      </div>

      <Card title="基本信息" size="small" style={{ marginBottom: 16 }}>
        <Descriptions column={2} size="small">
          {fields.map(({ label, key: k }) => (
            <Descriptions.Item key={k} label={label}>
              {String(props[k] ?? '-')}
            </Descriptions.Item>
          ))}
        </Descriptions>
        {props['影响及现存风险'] ? (
          <Paragraph
            style={{ marginTop: 8, marginBottom: 0 }}
            type="secondary"
          >
            <Text strong>影响及风险：</Text>{props['影响及现存风险'] as string}
          </Paragraph>
        ) : null}
      </Card>

      <Card
        title="进展时间线"
        size="small"
        style={{ marginBottom: 16 }}
        extra={
          <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setProgressOpen(true)}>
            追加进展
          </Button>
        }
      >
        {progress.length === 0 ? (
          <Text type="secondary">暂无进展记录</Text>
        ) : (
          <Timeline
            items={progress.map((p) => ({
              color: STATUS_COLOR[p.statusSnapshot] ?? 'gray',
              children: (
                <div>
                  <div>
                    <Text strong>{dayjs(p.updatedAt).format('MM/DD HH:mm')}</Text>
                    <StatusTag status={p.statusSnapshot} />
                  </div>
                  <Paragraph style={{ margin: 0 }}>{p.content}</Paragraph>
                </div>
              ),
            }))}
          />
        )}
      </Card>

      {helpers.length > 0 && (
        <Card title="找帮手推荐" size="small" style={{ marginBottom: 16 }}>
          <List
            size="small"
            dataSource={helpers}
            renderItem={(h, i) => (
              <List.Item>
                <Space>
                  {i === 0 && <span>🥇</span>}
                  {i === 1 && <span>🥈</span>}
                  {i === 2 && <span>🥉</span>}
                  <Avatar size="small" icon={<UserOutlined />} />
                  <Text strong>{(h.person.properties['姓名'] as string) ?? h.person.id.slice(0, 8)}</Text>
                  <Tag>得分 {h.score}</Tag>
                  <Text type="secondary">{h.reasons.join('、')}</Text>
                </Space>
              </List.Item>
            )}
          />
        </Card>
      )}

      <Collapse
        ghost
        items={[
          {
            key: 'audit',
            label: '操作审计',
            children: auditLogs.length === 0 ? (
              <Text type="secondary">暂无操作记录</Text>
            ) : (
              <List
                size="small"
                dataSource={auditLogs}
                renderItem={(a) => (
                  <List.Item>
                    <Text type="secondary">
                      {dayjs(a.performedAt).format('MM/DD HH:mm')} {a.performedBy} {a.action} {a.entityType}
                      {a.changes ? ` — ${JSON.stringify(a.changes)}` : ''}
                    </Text>
                  </List.Item>
                )}
              />
            ),
          },
        ]}
      />

      <Drawer
        title="编辑攻关信息"
        width={520}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        extra={
          <Button type="primary" loading={submitting} onClick={() => editForm.submit()}>
            保存
          </Button>
        }
      >
        <Form form={editForm} layout="vertical" onFinish={handleEdit}>
          <Form.Item name="标题" label="标题">
            <Input />
          </Form.Item>
          <Form.Item name="状态" label="状态">
            <Select options={STATUS_OPTIONS.map((s) => ({ value: s, label: s }))} />
          </Form.Item>
          <Form.Item name="问题单号" label="问题单号">
            <Input />
          </Form.Item>
          <Form.Item name="事件单号" label="事件单号">
            <Input />
          </Form.Item>
          <Form.Item name="事件级别" label="事件级别">
            <Input />
          </Form.Item>
          <Form.Item name="客户名称" label="客户名称">
            <Input />
          </Form.Item>
          <Form.Item name="当前处理人" label="当前处理人">
            <Select
              showSearch
              allowClear
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
              options={personOptions}
              filterOption={(input, option) =>
                (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
              }
            />
          </Form.Item>
          <Form.Item name="影响及现存风险" label="影响及现存风险">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="资源ID" label="资源ID">
            <Input />
          </Form.Item>
          <Form.Item name="租户ID" label="租户ID">
            <Input />
          </Form.Item>
        </Form>
      </Drawer>

      <Drawer
        title="状态流转"
        width={400}
        open={transitionOpen}
        onClose={() => setTransitionOpen(false)}
      >
        <Form form={transForm} layout="vertical" onFinish={handleTransition}>
          <div style={{ marginBottom: 16 }}>
            <Text type="secondary">当前状态：</Text>
            <StatusTag status={(props['状态'] as string) ?? ''} />
          </div>
          <Form.Item name="toStatus" label="目标状态" rules={[{ required: true }]}>
            <Select
              options={STATUS_OPTIONS.filter((s) => s !== (props['状态'] as string)).map((s) => ({
                value: s,
                label: s,
              }))}
            />
          </Form.Item>
          <Form.Item name="note" label="备注">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={submitting} block>
            确认流转
          </Button>
        </Form>
      </Drawer>

      <Drawer
        title="追加进展"
        width={400}
        open={progressOpen}
        onClose={() => setProgressOpen(false)}
      >
        <Form form={progForm} layout="vertical" onFinish={handleAddProgress}>
          <Form.Item name="content" label="进展内容" rules={[{ required: true, message: '请输入进展' }]}>
            <Input.TextArea rows={4} placeholder="描述当前进展..." />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={submitting} block>
            提交进展
          </Button>
        </Form>
      </Drawer>
    </div>
  );
}
