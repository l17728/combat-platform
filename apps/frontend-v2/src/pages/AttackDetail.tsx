import { useEffect, useState, useCallback } from 'react';
import {
  Typography, Button, Space, Card, Descriptions, Timeline, Drawer, Form, Input, Select,
  message, Popconfirm, Spin, Tag, List, Avatar, Row, Col, Tabs, Table, Modal, Tree, Empty, Alert,
  Tooltip, Steps, Divider, theme,
} from 'antd';
import {
  ArrowLeftOutlined, EditOutlined, SwapOutlined, PlusOutlined, UserOutlined,
  DeleteOutlined, LinkOutlined, InfoCircleOutlined, HistoryOutlined,
  FileTextOutlined, NodeIndexOutlined, TeamOutlined, CheckCircleOutlined,
  ClockCircleOutlined, ThunderboltOutlined, MinusCircleOutlined, SyncOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { api } from '../api.js';
import { STATUS_COLOR, STATUS_BAR_COLOR, SUPPORT_STATUS_COLOR, ACTION_COLOR, ACTION_LABEL, ENTITY_TYPE_LABEL, DATE_FORMAT, DATE_FORMAT_SHORT } from '../constants.js';
import StatusTag from '../components/StatusTag.js';
import { useSettings } from '../hooks/useSettings.js';
import type { GraphNode, ProgressLog, HelperRecommendation, AuditLogEntry, NodeSchema, FieldType } from '@combat/shared';
import type { DailyReportEntry, SupportNode, SupportTemplate } from '../api.js';
import HelpButton from '../components/HelpButton.js';
import HELP from '../help-content.js';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const { Title, Text, Paragraph } = Typography;
const FALLBACK_STATUS = ['待响应', '处理中', '进行中', '已解决', '已关闭'];
const FALLBACK_SUPPORT_CATEGORIES = ['环境', '领域专家', '团队协作', '资源'];
const FALLBACK_SUPPORT_STATUSES = ['待确认', '支持中', '已完成', '已撤销'];
const FALLBACK_DR_TYPES = ['进展通报', '风险通报'];
const STATUS_STEPS = FALLBACK_STATUS;
const HARDCODED_EDIT_FIELDS = new Set(['标题', '状态', '问题单号', '事件单号', '事件级别', '客户名称', '当前处理人', '攻关组长', '攻关申请人', '影响及现存风险', '资源ID', '租户ID']);
const SUMMARY_FIELD_IDS = new Set(['标题', '问题单号', '事件单号', '事件级别', '影响及现存风险', '客户名称', '故障发生时间', '当前处理人', '攻关组长']);
const TEAM_FIELDS = new Set(['攻关组长', '攻关成员']);

const STATUS_STEP_ICON: Record<string, React.ReactNode> = {
  '待响应': <ClockCircleOutlined />,
  '处理中': <SyncOutlined />,
  '进行中': <ThunderboltOutlined />,
  '已解决': <CheckCircleOutlined />,
  '已关闭': <MinusCircleOutlined />,
};

function getStatusStepIndex(status: string): number {
  return STATUS_STEPS.indexOf(status);
}

interface SupportNodeWithChildren extends SupportNode { children: SupportNodeWithChildren[] }

function buildTree(nodes: SupportNode[]) {
  const map = new Map<string, SupportNodeWithChildren>(nodes.map(n => [n.id, { ...n, children: [] }]));
  const roots: SupportNodeWithChildren[] = [];
  for (const n of map.values()) {
    if (n.parentId && map.has(n.parentId)) map.get(n.parentId)!.children.push(n);
    else roots.push(n);
  }
  return roots.map(({ children, ...rest }) => ({
    ...rest, key: rest.id, title: rest.domain, children: children.map(({ children: c2, ...r2 }) => ({ ...r2, key: r2.id, title: r2.domain, children: c2.map(c => ({ key: c.id, title: c.domain, ...c })) })),
  }));
}

export default function AttackDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const [node, setNode] = useState<GraphNode | null>(null);
  const [schema, setSchema] = useState<NodeSchema | null>(null);
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
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [transSubmitting, setTransSubmitting] = useState(false);
  const [progSubmitting, setProgSubmitting] = useState(false);
  const [people, setPeople] = useState<GraphNode[]>([]);

  const [dailyReports, setDailyReports] = useState<DailyReportEntry[]>([]);
  const [drLoading, setDrLoading] = useState(false);
  const [drModalOpen, setDrModalOpen] = useState(false);
  const [drForm] = Form.useForm();
  const [drSubmitting, setDrSubmitting] = useState(false);
  const [drDetail, setDrDetail] = useState<DailyReportEntry | null>(null);

  const [supportNodes, setSupportNodes] = useState<SupportNode[]>([]);
  const [supportLoading, setSupportLoading] = useState(false);
  const [supportModalOpen, setSupportModalOpen] = useState(false);
  const [editingNode, setEditingNode] = useState<SupportNode | null>(null);
  const [supportSubmitting, setSupportSubmitting] = useState(false);
  const [supportForm] = Form.useForm();
  const [templates, setTemplates] = useState<SupportTemplate[]>([]);
  const [addFieldOpen, setAddFieldOpen] = useState(false);
  const [newField, setNewField] = useState({ name: '', label: '', type: 'string' as FieldType });
  const { getValues } = useSettings();

  const STATUS_OPTIONS = getValues('状态', FALLBACK_STATUS);
  const SUPPORT_CATEGORIES = getValues('求助分类', FALLBACK_SUPPORT_CATEGORIES);
  const SUPPORT_STATUSES = getValues('求助状态', FALLBACK_SUPPORT_STATUSES);
  const DR_TYPES = getValues('日报类型', FALLBACK_DR_TYPES);

  const [initialLoading, setInitialLoading] = useState(true);
  const fetchData = useCallback(async (silent?: boolean) => {
    if (!id) return;
    if (!silent) setLoading(true);
    try {
      const [n, p, h, a, ppl, s] = await Promise.all([
        api.getNode(id), api.listProgress(id), api.recommendHelpers(id, 5).catch(() => []),
        api.listAudit({ entityId: id, limit: 20 }).catch(() => []),
        api.listNodes('person').catch(() => []), api.getSchema('attackTicket').catch(() => null),
      ]);
      setNode(n); setProgress(p); setHelpers(h); setAuditLogs(a); setPeople(ppl); setSchema(s);
    } catch (e: any) { message.error(e.message); }
    finally { setLoading(false); setInitialLoading(false); }
  }, [id]);

  const fetchDailyReports = useCallback(async () => {
    if (!id) return;
    setDrLoading(true);
    try { setDailyReports(await api.listDailyReportEntries(id)); }
    catch {} finally { setDrLoading(false); }
  }, [id]);

  const fetchSupportNodes = useCallback(async () => {
    if (!id) return;
    setSupportLoading(true);
    try {
      const [nodes, tmpls] = await Promise.all([
        api.listSupportNodes(id),
        api.listSupportTemplates().catch(() => []),
      ]);
      setSupportNodes(nodes);
      setTemplates(tmpls);
    } catch (e: any) { message.error(e.message); }
    finally { setSupportLoading(false); }
  }, [id]);

  useEffect(() => { fetchData(); fetchDailyReports(); fetchSupportNodes(); }, [fetchData, fetchDailyReports, fetchSupportNodes]);

  if (initialLoading || !node) return <Spin size="large" style={{ display: 'block', marginTop: 100 }} />;

  const props = node.properties;
  const personOptions = people.map(p => ({
    value: (p.properties['姓名'] as string) ?? '', label: `${p.properties['姓名'] ?? p.id} (${p.properties['部门'] ?? '-'})`,
  }));
  const status = String(props['状态'] ?? '');
  const title = String(props['标题'] ?? id!.slice(0, 8));
  const currentStep = getStatusStepIndex(status);

  const missingFields = schema?.fields.filter(f => !f.retired && f.required && !node.properties[f.name]?.toString().trim()) ?? [];
  const basicFields = schema?.fields.filter(f => !f.retired && !SUMMARY_FIELD_IDS.has(f.name)) ?? [];
  const teamFields = schema?.fields.filter(f => !f.retired && TEAM_FIELDS.has(f.name)) ?? [];

  const summaryItems = [
    { label: '问题单号', value: props['问题单号'] },
    { label: '事件单号', value: props['事件单号'] },
    { label: '事件级别', value: props['事件级别'] },
    { label: '客户名称', value: props['客户名称'] },
    { label: '当前处理人', value: props['当前处理人'] },
    { label: '攻关组长', value: props['攻关组长'] },
    { label: '故障发生时间', value: props['故障发生时间'] },
    { label: '影响及现存风险', value: props['影响及现存风险'] },
  ].filter(item => item.value);

  const handleEdit = async (values: Record<string, unknown>) => {
    if (!id) return;
    setEditSubmitting(true);
    try { await api.updateNode(id, values); message.success('更新成功'); setEditOpen(false); fetchData(true); }
    catch (e: any) { message.error(e.message); } finally { setEditSubmitting(false); }
  };

  const handleTransition = async (values: { toStatus: string; note?: string }) => {
    if (!id) return;
    setTransSubmitting(true);
    try { await api.transition(id, values.toStatus, values.note); message.success('状态流转成功'); setTransitionOpen(false); transForm.resetFields(); fetchData(true); }
    catch (e: any) { message.error(e.message); } finally { setTransSubmitting(false); }
  };

  const handleAddProgress = async (values: { content: string }) => {
    if (!id) return;
    setProgSubmitting(true);
    try { await api.appendProgress(id, values.content, status); message.success('进展已追加'); setProgressOpen(false); progForm.resetFields(); fetchData(true); }
    catch (e: any) { message.error(e.message); } finally { setProgSubmitting(false); }
  };

  const handleDelete = async () => {
    if (!id) return;
    try { await api.deleteNode(id); message.success('已删除'); navigate('/attack'); }
    catch (e: any) { message.error(e.message); }
  };

  const createDailyReport = async (values: { type: string; currentProgress: string; nextSteps?: string }) => {
    if (!id) return;
    setDrSubmitting(true);
    try { await api.createDailyReportEntry(id, values); message.success('日报条目已创建'); setDrModalOpen(false); drForm.resetFields(); fetchDailyReports(); }
    catch (e: any) { message.error(e.message); } finally { setDrSubmitting(false); }
  };

  const handleSupportSubmit = async (values: any) => {
    if (!id) return;
    setSupportSubmitting(true);
    try {
      if (editingNode) { await api.updateSupportNode(editingNode.id, values); message.success('节点已更新'); }
      else { await api.createSupportNode(id, values); message.success('节点已添加'); }
      setSupportModalOpen(false); supportForm.resetFields(); setEditingNode(null); fetchSupportNodes();
    } catch (e: any) { message.error(e.message); } finally { setSupportSubmitting(false); }
  };

  const handleDeleteSupportNode = async (nodeId: string) => {
    try { await api.deleteSupportNode(nodeId); message.success('节点已删除'); fetchSupportNodes(); }
    catch (e: any) { message.error(e.message); }
  };

  const handleApplyTemplate = async (templateId: string) => {
    if (!id) return;
    try {
      const result = await api.applySupportTemplate(templateId, id);
      message.success(`已应用模板，创建 ${result.applied} 个节点`);
      fetchSupportNodes();
    } catch (e: any) { message.error(e.message); }
  };

  const extraEditFields = (schema?.fields ?? []).filter(f => !f.retired && !HARDCODED_EDIT_FIELDS.has(f.name));

  const handleAddField = async () => {
    if (!newField.name.trim()) { message.warning('请输入字段名'); return; }
    try {
      const updated = await api.patchSchema('attackTicket', {
        op: 'addField',
        field: { name: newField.name.trim(), label: newField.label.trim() || newField.name.trim(), type: newField.type },
      });
      setSchema(updated);
      setAddFieldOpen(false);
      setNewField({ name: '', label: '', type: 'string' });
      message.success('字段已添加');
    } catch (e: any) { message.error(e.message); }
  };

  const drColumns = [
    { title: '日报类型', dataIndex: 'type', width: 100 },
    { title: '当前进展', dataIndex: 'currentProgress', render: (v: string) => v.length > 120 ? v.slice(0, 120) + '…' : v },
    { title: '下一步计划', dataIndex: 'nextSteps', render: (v: string) => v ? (v.length > 80 ? v.slice(0, 80) + '…' : v) : '--' },
    { title: '状态', dataIndex: 'status', width: 80, render: (v: string) => <Tag color={v === '已发布' ? 'green' : 'default'}>{v}</Tag> },
    { title: '创建时间', dataIndex: 'createdAt', width: 150, render: (v: string) => dayjs(v).format('MM/DD HH:mm') },
    { title: '操作', width: 150, render: (_: unknown, r: DailyReportEntry) => (
      <Space size={4}>
        <Button size="small" type="link" onClick={() => setDrDetail(r)}>详情</Button>
        <Button size="small" type="link" disabled={r.status === '已发布'} onClick={async () => { if (id) { await api.publishDailyReportEntry(id, r.id); message.success('已发布'); fetchDailyReports(); } }}>发布</Button>
        <Button size="small" type="link" danger disabled={r.status === '已发布'} onClick={async () => { if (id) { await api.deleteDailyReportEntry(id, r.id); message.success('已删除'); fetchDailyReports(); } }}>删除</Button>
      </Space>
    )},
  ];

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Button type="link" icon={<ArrowLeftOutlined />} onClick={() => navigate('/attack')} style={{ paddingLeft: 0 }}>返回列表</Button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <Title level={4} style={{ margin: 0 }}>{title} <StatusTag status={status} /></Title>
          <Text type="secondary">创建于 {dayjs(node.createdAt).format(DATE_FORMAT)} · 更新于 {dayjs(node.updatedAt).fromNow()}</Text>
        </div>
        <Space>
          <HelpButton title={HELP.attackDetail.title} content={HELP.attackDetail.content} />
          <Link to={`/related/attackTicket/${id}`}><Button icon={<LinkOutlined />}>关联全景</Button></Link>
          <Button icon={<SwapOutlined />} onClick={() => setTransitionOpen(true)}>状态流转</Button>
          <Button icon={<EditOutlined />} onClick={() => { editForm.setFieldsValue(props as any); setEditOpen(true); }}>编辑信息</Button>
          <Popconfirm title="确认删除此攻关单？" onConfirm={handleDelete}><Button danger icon={<DeleteOutlined />}>删除</Button></Popconfirm>
        </Space>
      </div>

      {missingFields.length > 0 && (
        <Alert type="warning" message={`以下必填信息尚未填写：${missingFields.map(f => f.label).join('、')}`}
          description="请点击编辑补充完整" showIcon style={{ marginBottom: 16 }} closable />
      )}

      <Card size="small" style={{ marginBottom: 16 }}>
        <Steps size="small" current={currentStep}
          items={STATUS_STEPS.map((s, i) => ({
            title: s,
            icon: STATUS_STEP_ICON[s],
            status: i < currentStep ? 'finish' : i === currentStep ? 'process' : 'wait',
          }))}
        />
      </Card>

      {summaryItems.length > 0 && (
        <Card size="small" style={{ marginBottom: 16 }}>
          <Descriptions column={3} size="small">
            {summaryItems.map(item => (
              <Descriptions.Item key={String(item.label)} label={String(item.label)}>
                {item.label === '影响及现存风险'
                  ? <Tooltip title={String(item.value)}><span>{String(item.value).length > 40 ? String(item.value).slice(0, 40) + '…' : String(item.value)}</span></Tooltip>
                  : String(item.value)}
              </Descriptions.Item>
            ))}
          </Descriptions>
        </Card>
      )}

      <Row gutter={16}>
        <Col span={18}>
          <Card styles={{ body: { padding: 0 } }}>
            <Tabs defaultActiveKey="basic" style={{ padding: '0 16px' }} items={[
              {
                key: 'basic', label: <span><InfoCircleOutlined /> 基础信息</span>,
                children: (
                  <div style={{ padding: '16px 0' }}>
                    <Descriptions bordered column={2} size="small" style={{ marginBottom: 24 }}>
                      {basicFields.map(f => (
                        <Descriptions.Item key={f.name} label={f.label}>
                          {String(props[f.name] ?? '--')}
                        </Descriptions.Item>
                      ))}
                    </Descriptions>
                    {helpers.length > 0 && (
                      <>
                        <Divider orientation="left" orientationMargin={0}>找帮手推荐</Divider>
                        <List size="small" grid={{ column: 1 }} dataSource={helpers.slice(0, 3)} renderItem={(h, i) => (
                          <List.Item>
                            <Space>
                              <Tag color={i === 0 ? 'gold' : i === 1 ? '#c0c0c0' : '#cd7f32'}>#{i + 1}</Tag>
                              <Avatar size="small" icon={<UserOutlined />} />
                              <Text strong>{(h.person.properties['姓名'] as string) ?? h.person.id.slice(0, 8)}</Text>
                              <Tag>得分 {h.score}</Tag>
                              {h.reasons?.length > 0 && <Text type="secondary">{h.reasons[0]}</Text>}
                            </Space>
                          </List.Item>
                        )} />
                      </>
                    )}
                  </div>
                ),
              },
              {
                key: 'progress', label: <span><SwapOutlined /> 进展同步</span>,
                children: (
                  <div style={{ padding: '16px 0' }}>
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => setProgressOpen(true)} style={{ marginBottom: 16 }}>追加进展</Button>
                    {progress.length === 0 ? <Empty description="暂无进展记录" image={Empty.PRESENTED_IMAGE_SIMPLE} /> : (
                      <Timeline items={progress.map(p => ({
                        color: STATUS_COLOR[p.statusSnapshot] ?? 'gray',
                        children: <div><div><Text strong>{dayjs(p.updatedAt).format('MM/DD HH:mm')}</Text> <StatusTag status={p.statusSnapshot} /></div><Paragraph style={{ margin: '4px 0 0' }}>{p.content}</Paragraph></div>,
                      }))} />
                    )}
                  </div>
                ),
              },
              {
                key: 'dailyReport', label: <span><FileTextOutlined /> 日报更新</span>,
                children: (
                  <div style={{ padding: '16px 0' }}>
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => { drForm.resetFields(); setDrModalOpen(true); }} style={{ marginBottom: 16 }}>创建</Button>
                    <Table size="small" loading={drLoading} dataSource={dailyReports} columns={drColumns} rowKey="id"
                      pagination={{ pageSize: 10 }} locale={{ emptyText: <Empty description="暂无日报条目" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }} />
                  </div>
                ),
              },
              {
                key: 'audit', label: <span><HistoryOutlined /> 历史记录</span>,
                children: (
                  <div style={{ padding: '16px 0' }}>
                    {auditLogs.length === 0 ? <Empty description="暂无审计记录" image={Empty.PRESENTED_IMAGE_SIMPLE} /> : (
                      <List size="small" dataSource={auditLogs} renderItem={a => (
                        <List.Item>
                          <Space size={8}>
                            <Text type="secondary">{dayjs(a.performedAt).format(DATE_FORMAT_SHORT)}</Text>
                            <Tag color={ACTION_COLOR[a.action]}>{ACTION_LABEL[a.action] || a.action}</Tag>
                            <Text>{a.performedBy}</Text>
                            <Text type="secondary">{ENTITY_TYPE_LABEL[a.entityType] || a.entityType}</Text>
                            {(() => {
                              const ch = a.changes as Record<string, unknown> | undefined;
                              if (!ch || typeof ch !== 'object' || Object.keys(ch).length === 0) return null;
                              return (
                                <Tooltip title={Object.entries(ch).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n')}>
                                  <Tag>{Object.keys(ch).length}项变更</Tag>
                                </Tooltip>
                              );
                            })()}
                          </Space>
                        </List.Item>
                      )} />
                    )}
                  </div>
                ),
              },
              {
                key: 'support', label: <span><NodeIndexOutlined /> 求助网络</span>,
                children: (
                  <div style={{ padding: '16px 0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                      <Space>
                        <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingNode(null); supportForm.resetFields(); supportForm.setFieldsValue({ status: '待确认' }); setSupportModalOpen(true); }}>添加节点</Button>
                        {templates.length > 0 && (
                          <Select placeholder="应用模板" style={{ width: 160 }} allowClear
                            onChange={(v) => v && handleApplyTemplate(v)}
                            options={templates.map(t => ({ value: t.id, label: `${t.name} (${t.usageCount})` }))} />
                        )}
                      </Space>
                    </div>
                    {supportLoading ? <Spin /> : supportNodes.length === 0 ? <Empty description="暂无求助节点" image={Empty.PRESENTED_IMAGE_SIMPLE} /> : (
                      <Tree treeData={buildTree(supportNodes)} defaultExpandAll titleRender={(nd: any) => (
                        <Space size={8}>
                          <Tag color="blue">{nd.category}</Tag>
                          <Text>{nd.domain}</Text>
                          <Text type="secondary">→</Text>
                          <Text>{nd.personName || '待指定'}</Text>
                          <Tag color={SUPPORT_STATUS_COLOR[nd.status] ?? 'default'}>{nd.status}</Tag>
                          <Button size="small" type="text" icon={<EditOutlined />} onClick={e => { e.stopPropagation(); setEditingNode(nd); supportForm.setFieldsValue({ parentId: nd.parentId ?? undefined, category: nd.category, domain: nd.domain, personName: nd.personName ?? undefined, status: nd.status, note: nd.note }); setSupportModalOpen(true); }} />
                          <Popconfirm title="确认删除该节点？" onConfirm={() => handleDeleteSupportNode(nd.id)}>
                            <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={e => e.stopPropagation()} />
                          </Popconfirm>
                        </Space>
                      )} />
                    )}
                  </div>
                ),
              },
            ]} />
          </Card>
        </Col>
        <Col span={6}>
          {helpers.length > 0 && (
            <Card title="找帮手推荐" size="small" style={{ marginBottom: 16 }} extra={<Tag>{helpers.length}人</Tag>}>
              <List size="small" dataSource={helpers} renderItem={(h, i) => (
                <List.Item style={{ padding: '6px 0' }}>
                  <Space>
                    <Tag color={i === 0 ? 'gold' : i === 1 ? '#c0c0c0' : i === 2 ? '#cd7f32' : 'default'}>#{i + 1}</Tag>
                    <Avatar size="small" icon={<UserOutlined />} />
                    <Text strong>{(h.person.properties['姓名'] as string) ?? h.person.id.slice(0, 8)}</Text>
                    <Text type="secondary">{h.score}分</Text>
                  </Space>
                </List.Item>
              )} />
            </Card>
          )}
          <Card title="攻关成员" size="small" extra={<TeamOutlined />}>
            <Descriptions column={1} size="small">
              {teamFields.map(f => <Descriptions.Item key={f.name} label={f.label}>{String(props[f.name] ?? '-')}</Descriptions.Item>)}
            </Descriptions>
          </Card>
        </Col>
      </Row>

      <Drawer title="编辑攻关信息" width={520} open={editOpen} onClose={() => setEditOpen(false)} destroyOnClose maskClosable={false}
        extra={<Button type="primary" loading={editSubmitting} onClick={() => editForm.submit()}>保存</Button>}>
        <Form form={editForm} layout="vertical" onFinish={handleEdit}>
          <Divider orientation="left" orientationMargin={0}>基本信息</Divider>
          <Form.Item name="标题" label="标题" rules={[{ required: true, message: '标题不能为空' }]}><Input /></Form.Item>
          <Form.Item name="状态" label="状态"><Select options={STATUS_OPTIONS.map(s => ({ value: s, label: s }))} /></Form.Item>
          <Form.Item name="问题单号" label="问题单号"><Input /></Form.Item>
          <Form.Item name="事件单号" label="事件单号"><Input /></Form.Item>
          <Form.Item name="事件级别" label="事件级别"><Input /></Form.Item>
          <Form.Item name="客户名称" label="客户名称"><Input /></Form.Item>
          <Divider orientation="left" orientationMargin={0}>人员信息</Divider>
          <Form.Item name="当前处理人" label="当前处理人"><Select showSearch allowClear placeholder="搜索人员" options={personOptions} filterOption={(input, option) => (option?.label as string)?.toLowerCase().includes(input.toLowerCase())} /></Form.Item>
          <Form.Item name="攻关组长" label="攻关组长"><Select showSearch allowClear placeholder="搜索人员" options={personOptions} filterOption={(input, option) => (option?.label as string)?.toLowerCase().includes(input.toLowerCase())} /></Form.Item>
          <Form.Item name="攻关申请人" label="攻关申请人"><Select showSearch allowClear placeholder="搜索人员" options={personOptions} filterOption={(input, option) => (option?.label as string)?.toLowerCase().includes(input.toLowerCase())} /></Form.Item>
          <Divider orientation="left" orientationMargin={0}>详细信息</Divider>
          <Form.Item name="影响及现存风险" label="影响及现存风险"><Input.TextArea rows={3} /></Form.Item>
          <Form.Item name="资源ID" label="资源ID"><Input /></Form.Item>
          <Form.Item name="租户ID" label="租户ID"><Input /></Form.Item>
          {extraEditFields.length > 0 && (
            <>
              <Divider orientation="left" orientationMargin={0}>自定义字段</Divider>
              {extraEditFields.map(f => (
                <Form.Item key={f.id} name={f.name} label={f.label}>
                  {f.type === 'enum' ? (
                    <Select allowClear options={(f.enumValues ?? []).map(v => ({ value: v, label: v }))} />
                  ) : f.type === 'number' ? (
                    <Input type="number" placeholder={f.label} />
                  ) : f.type === 'date' ? (
                    <Input type="date" />
                  ) : f.type === 'datetime' ? (
                    <Input type="datetime-local" />
                  ) : (
                    <Input placeholder={f.label} />
                  )}
                </Form.Item>
              ))}
            </>
          )}
          <div style={{ textAlign: 'center', marginTop: 8 }}>
            <Button type="dashed" block icon={<PlusOutlined />} onClick={() => setAddFieldOpen(true)}>+字段</Button>
          </div>
        </Form>
      </Drawer>

      <Drawer title="状态流转" width={400} open={transitionOpen} onClose={() => setTransitionOpen(false)} destroyOnClose maskClosable={false}>
        <Form form={transForm} layout="vertical" onFinish={handleTransition}>
          <div style={{ marginBottom: 16 }}>
            <Text type="secondary">当前状态：</Text><StatusTag status={status} />
          </div>
          <Card size="small" style={{ marginBottom: 16 }}>
            <Steps size="small" current={currentStep}
              items={STATUS_STEPS.map((s, i) => ({
                title: s,
                icon: STATUS_STEP_ICON[s],
                status: i < currentStep ? 'finish' : i === currentStep ? 'process' : 'wait',
              }))}
            />
          </Card>
          <Form.Item name="toStatus" label="目标状态" rules={[{ required: true, message: '请选择目标状态' }]}>
            <Select options={STATUS_OPTIONS.filter(s => s !== status).map(s => ({ value: s, label: s }))} />
          </Form.Item>
          <Form.Item name="note" label="备注"><Input.TextArea rows={3} placeholder="状态变更原因..." /></Form.Item>
          <Button type="primary" htmlType="submit" loading={transSubmitting} block>确认流转</Button>
        </Form>
      </Drawer>

      <Drawer title="追加进展" width={400} open={progressOpen} onClose={() => setProgressOpen(false)} destroyOnClose maskClosable={false}>
        <Form form={progForm} layout="vertical" onFinish={handleAddProgress}>
          <div style={{ marginBottom: 16 }}>
            <Text type="secondary">当前状态：</Text><StatusTag status={status} />
          </div>
          <Form.Item name="content" label="进展内容" rules={[{ required: true, message: '请输入进展' }]}>
            <Input.TextArea rows={5} placeholder="描述当前进展..." />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={progSubmitting} block>提交进展</Button>
        </Form>
      </Drawer>

      <Modal title="创建日报条目" open={drModalOpen} onCancel={() => setDrModalOpen(false)} footer={null} destroyOnClose>
        <Form form={drForm} layout="vertical" initialValues={{ type: '进展通报' }} onFinish={createDailyReport}>
          <Form.Item name="type" label="日报类型"><Select options={DR_TYPES.map(t => ({ value: t, label: t }))} /></Form.Item>
          <Form.Item name="currentProgress" label="当前进展" rules={[{ required: true, message: '当前进展必填' }]}><Input.TextArea rows={4} placeholder="请输入当前进展..." /></Form.Item>
          <Form.Item name="nextSteps" label="下一步计划"><Input.TextArea rows={3} placeholder="请输入下一步计划..." /></Form.Item>
          <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}><Space><Button onClick={() => setDrModalOpen(false)}>取消</Button><Button type="primary" htmlType="submit" loading={drSubmitting}>提交</Button></Space></Form.Item>
        </Form>
      </Modal>

      <Modal title="日报条目详情" open={!!drDetail} onCancel={() => setDrDetail(null)} footer={<Button onClick={() => setDrDetail(null)}>关闭</Button>} width={720} destroyOnClose>
        {drDetail && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="日报类型">{drDetail.type}</Descriptions.Item>
            <Descriptions.Item label="状态"><Tag color={drDetail.status === '已发布' ? 'green' : 'default'}>{drDetail.status}</Tag></Descriptions.Item>
            <Descriptions.Item label="当前进展"><div style={{ whiteSpace: 'pre-wrap' }}>{drDetail.currentProgress}</div></Descriptions.Item>
            <Descriptions.Item label="下一步计划"><div style={{ whiteSpace: 'pre-wrap' }}>{drDetail.nextSteps || '--'}</div></Descriptions.Item>
            <Descriptions.Item label="创建时间">{dayjs(drDetail.createdAt).format(DATE_FORMAT)}</Descriptions.Item>
          </Descriptions>
        )}
      </Modal>

      <Modal title={editingNode ? '编辑求助节点' : '添加求助节点'} open={supportModalOpen} onCancel={() => { setSupportModalOpen(false); setEditingNode(null); }} footer={null} destroyOnClose>
        <Form form={supportForm} layout="vertical" onFinish={handleSupportSubmit}>
          <Form.Item name="parentId" label="上级节点（可选）"><Select allowClear placeholder="选择上级节点" options={supportNodes.filter(sn => !editingNode || sn.id !== editingNode.id).map(sn => ({ value: sn.id, label: sn.domain }))} /></Form.Item>
          <Form.Item name="category" label="大类" rules={[{ required: true, message: '请选择大类' }]}><Select placeholder="选择大类" options={SUPPORT_CATEGORIES.map(c => ({ value: c, label: c }))} /></Form.Item>
          <Form.Item name="domain" label="具体领域" rules={[{ required: true, message: '请输入具体领域' }]}><Input placeholder="请输入具体领域" /></Form.Item>
          <Form.Item name="personName" label="负责人姓名（可选）"><Input placeholder="请输入负责人姓名" /></Form.Item>
          <Form.Item name="status" label="状态" initialValue="待确认"><Select options={SUPPORT_STATUSES.map(s => ({ value: s, label: s }))} /></Form.Item>
          <Form.Item name="note" label="备注"><Input.TextArea rows={3} placeholder="备注..." /></Form.Item>
          <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}><Space><Button onClick={() => { setSupportModalOpen(false); setEditingNode(null); }}>取消</Button><Button type="primary" htmlType="submit" loading={supportSubmitting}>提交</Button></Space></Form.Item>
        </Form>
      </Modal>

      <Modal title="新增字段" open={addFieldOpen} okText="添加" onCancel={() => setAddFieldOpen(false)} onOk={handleAddField}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input placeholder="字段名(name)" value={newField.name} onChange={e => setNewField(s => ({ ...s, name: e.target.value }))} />
          <Input placeholder="显示名(label)" value={newField.label} onChange={e => setNewField(s => ({ ...s, label: e.target.value }))} />
          <Select value={newField.type} style={{ width: 160 }} onChange={v => setNewField(s => ({ ...s, type: v }))}
            options={['string', 'number', 'date', 'datetime', 'enum'].map(t => ({ value: t, label: t }))} />
        </Space>
      </Modal>
    </div>
  );
}
