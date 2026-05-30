import { useEffect, useState, useCallback } from 'react';
import {
  Typography, Button, Space, Card, Descriptions, Timeline, Drawer, Form, Input, Select,
  message, Popconfirm, Spin, Tag, List, Avatar, Row, Col, Tabs, Table, Modal, Tree, Empty, Alert,
  Tooltip, Steps, Divider, theme, Dropdown, Popover, Checkbox,
} from 'antd';
import {
  ArrowLeftOutlined, EditOutlined, SwapOutlined, PlusOutlined, UserOutlined,
  DeleteOutlined, LinkOutlined, InfoCircleOutlined, HistoryOutlined,
  FileTextOutlined, NodeIndexOutlined, TeamOutlined, CheckCircleOutlined,
  ClockCircleOutlined, ThunderboltOutlined, MinusCircleOutlined, SyncOutlined,
  CloseOutlined, AppstoreOutlined, LockOutlined, UnlockOutlined, MessageOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { api, type TicketTab } from '../api.js';
import { STATUS_COLOR, STATUS_BAR_COLOR, SUPPORT_STATUS_COLOR, ACTION_COLOR, ACTION_LABEL, ENTITY_TYPE_LABEL, DATE_FORMAT, DATE_FORMAT_SHORT, TAB_TYPE_LABEL, NODE_TYPE_LABEL } from '../constants.js';
import { nodeLabel } from '../utils/nodeLabel.js';
import { parseMembers, syncMemberFields, buildMembersFromForm, type TeamMember, type TeamRole } from '../utils/teamMembers.js';
import { filterKeyAudits, type CategorizedAudit } from '../utils/auditFilter.js';
import { useAuth } from '../hooks/useAuth.js';
import StatusTag from '../components/StatusTag.js';
import AddTabModal from '../components/AddTabModal.js';
import DynamicLinkTab from '../components/DynamicLinkTab.js';
import DynamicCustomTab from '../components/DynamicCustomTab.js';
import WelinkTab from './WelinkTab.js';
import { useSettings } from '../hooks/useSettings.js';
import type { GraphNode, ProgressLog, HelperRecommendation, AuditLogEntry, NodeSchema } from '@combat/shared';
import type { DailyReportEntry, SupportNode, SupportTemplate, RelatedResult } from '../api.js';
import HelpButton from '../components/HelpButton.js';
import HELP from '../help-content.js';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const { Title, Text, Paragraph } = Typography;
const STATUS_STEPS = ['待响应', '处理中', '进行中', '已解决', '已关闭'];
// 攻关成员/成员列表 由专用多选 + 成员管理 tab 维护,不在 extraEditFields 通用渲染中出现
const HARDCODED_EDIT_FIELDS = new Set(['标题', '状态', '问题单号', '事件单号', '事件级别', '客户名称', '当前处理人', '攻关组长', '攻关成员', '成员列表', '攻关申请人', '影响及现存风险', '资源ID', '租户ID', '创建人', '私密', '私密授权人', '私密授权组']);
const SUMMARY_FIELD_IDS = new Set(['标题', '问题单号', '事件单号', '事件级别', '影响及现存风险', '客户名称', '故障发生时间', '当前处理人', '攻关组长']);
const TEAM_FIELDS = new Set(['攻关组长', '攻关成员']);
const ROLE_OPTIONS: TeamRole[] = ['组长', '组员'];

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
  const [editingDr, setEditingDr] = useState<DailyReportEntry | null>(null);
  const [drDetail, setDrDetail] = useState<DailyReportEntry | null>(null);

  const [supportNodes, setSupportNodes] = useState<SupportNode[]>([]);
  const [supportLoading, setSupportLoading] = useState(false);
  const [selectedPersonName, setSelectedPersonName] = useState<string | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<GraphNode | null>(null);
  const [personRelated, setPersonRelated] = useState<RelatedResult | null>(null);
  const [personPanelLoading, setPersonPanelLoading] = useState(false);
  const [supportModalOpen, setSupportModalOpen] = useState(false);
  const [editingNode, setEditingNode] = useState<SupportNode | null>(null);
  const [supportSubmitting, setSupportSubmitting] = useState(false);
  const [supportForm] = Form.useForm();
  const [templates, setTemplates] = useState<SupportTemplate[]>([]);
  const { getValues } = useSettings();

  const [dynamicTabs, setDynamicTabs] = useState<TicketTab[]>([]);
  const [addTabOpen, setAddTabOpen] = useState(false);
  // 面板默认收起,腾空间给主内容;用户主动勾选才显示卡;不持久化(每次进来都默认收起)
  const [visibleCards, setVisibleCards] = useState<string[]>([]);

  // 基础信息字段隐藏:按用户名持久化到 localStorage;若未保存则全部显示
  const auth = useAuth();
  const basicFieldsKey = `attack-detail-hidden-basic-fields:${auth.user?.username || 'guest'}`;
  const [hiddenBasicFields, setHiddenBasicFields] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(basicFieldsKey) || '[]'); }
    catch { return []; }
  });
  useEffect(() => {
    try { localStorage.setItem(basicFieldsKey, JSON.stringify(hiddenBasicFields)); } catch {}
  }, [hiddenBasicFields, basicFieldsKey]);

  // 成员管理 drawer 状态:editingIdx 为 null 时是新增,数字时是修改对应下标的成员
  const [memberDrawerOpen, setMemberDrawerOpen] = useState(false);
  const [editingMemberIdx, setEditingMemberIdx] = useState<number | null>(null);
  const [memberForm] = Form.useForm<{ 姓名: string; 角色: TeamRole }>();

  // 私密设置 drawer
  const [privacyDrawerOpen, setPrivacyDrawerOpen] = useState(false);
  const [privacyForm] = Form.useForm<{ 授权人: string[]; 授权组: string[] }>();
  const [emailGroups, setEmailGroups] = useState<GraphNode[]>([]);
  useEffect(() => { api.listNodes('emailGroup').then(setEmailGroups).catch(() => setEmailGroups([])); }, []);

  const { isAdmin, isLeader } = auth;
  // 合规追溯 卡仅对 leader/admin 开放;normal 角色看不到
  const SIDEBAR_CARD_OPTIONS = [
    { key: 'helpers', label: '找帮手推荐' },
    ...(isLeader ? [{ key: 'audit', label: '合规追溯' }] : []),
  ];

  const STATUS_OPTIONS = getValues('状态').length > 0 ? getValues('状态') : STATUS_STEPS;
  const SUPPORT_CATEGORIES = getValues('求助分类');
  const SUPPORT_STATUSES = getValues('求助状态');
  const DR_TYPES = getValues('日报类型');

  const [initialLoading, setInitialLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const fetchData = useCallback(async (silent?: boolean) => {
    if (!id) return;
    if (!silent) setLoading(true);
    try {
      const n = await api.getNode(id);
      const [p, h, a, ppl, s] = await Promise.all([
        api.listProgress(id), api.recommendHelpers(id, 5).catch(() => []),
        api.listAudit({ entityId: id, limit: 20 }).catch(() => []),
        api.listNodes('person').catch(() => []), api.getSchema('attackTicket').catch(() => null),
      ]);
      setNode(n); setProgress(p); setHelpers(h); setAuditLogs(a); setPeople(ppl); setSchema(s);
      setAccessDenied(false);
    } catch (e: any) {
      // 私密攻关单 GET 返回 403 时,显示无权访问页而非 toast 报错
      if (typeof e?.message === 'string' && /私密|403/.test(e.message)) setAccessDenied(true);
      else message.error(e.message);
    }
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

  const fetchDynamicTabs = useCallback(async () => {
    if (!id) return;
    try { setDynamicTabs(await api.listTicketTabs(id)); }
    catch {}
  }, [id]);

  useEffect(() => { fetchData(); fetchDailyReports(); fetchSupportNodes(); fetchDynamicTabs(); }, [fetchData, fetchDailyReports, fetchSupportNodes, fetchDynamicTabs]);

  if (accessDenied) {
    return (
      <div style={{ padding: 80, textAlign: 'center' }}>
        <LockOutlined style={{ fontSize: 48, color: '#fa8c16' }} />
        <Title level={4} style={{ marginTop: 16 }}>无权访问该攻关单</Title>
        <Text type="secondary">这是一个私密攻关单,仅创建人、成员及指定授权人/群组可见。</Text>
        <div style={{ marginTop: 24 }}>
          <Button onClick={() => navigate('/attack')}>返回列表</Button>
        </div>
      </div>
    );
  }
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
    try {
      // 编辑表单里 攻关组长(单) + 攻关成员(多)分别录入,统一派生 成员列表 + 同步字符串字段
      const memberNames = Array.isArray(values['攻关成员']) ? (values['攻关成员'] as string[]) : [];
      const leader = typeof values['攻关组长'] === 'string' ? (values['攻关组长'] as string) : '';
      const members = buildMembersFromForm(leader, memberNames);
      const synced = syncMemberFields(members);
      await api.updateNode(id, { ...values, ...synced });
      message.success('更新成功'); setEditOpen(false); fetchData(true);
    }
    catch (e: any) { message.error(e.message); } finally { setEditSubmitting(false); }
  };

  // 私密功能:仅创建人可设置/取消;授权人/组追加到 成员+创建人 形成访问白名单
  const isPrivate = String(props['私密'] ?? '') === '是';
  const isCreator = !!props['创建人'] && auth.user?.username === props['创建人'];
  const parsePrivacyJson = (key: string): string[] => {
    try { const v = JSON.parse(String(props[key] ?? '[]')); return Array.isArray(v) ? v.map(String) : []; }
    catch { return []; }
  };
  const openPrivacyDrawer = () => {
    privacyForm.setFieldsValue({ 授权人: parsePrivacyJson('私密授权人'), 授权组: parsePrivacyJson('私密授权组') });
    setPrivacyDrawerOpen(true);
  };
  const submitPrivacy = async (values: { 授权人?: string[]; 授权组?: string[] }) => {
    if (!id) return;
    try {
      await api.updateNode(id, {
        私密: '是',
        私密授权人: JSON.stringify(values.授权人 ?? []),
        私密授权组: JSON.stringify(values.授权组 ?? []),
      });
      setPrivacyDrawerOpen(false);
      await fetchData(true);
      message.success(isPrivate ? '私密配置已更新' : '已设置为私密');
    } catch (e: any) { message.error(e.message); }
  };
  const cancelPrivacy = async () => {
    if (!id) return;
    try {
      await api.updateNode(id, { 私密: '否' });
      await fetchData(true);
      message.success('已取消私密');
    }
    catch (e: any) { message.error(e.message); }
  };

  // 成员管理 tab CRUD:整存整取,保证三字段同步
  const updateMembers = async (next: TeamMember[]) => {
    if (!id) return;
    try {
      await api.updateNode(id, syncMemberFields(next));
      message.success('成员已更新');
      fetchData(true);
    } catch (e: any) { message.error(e.message); }
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
    try {
      if (editingDr) {
        await api.updateDailyReportEntry(id, editingDr.id, values);
        message.success('日报条目已更新');
      } else {
        await api.createDailyReportEntry(id, values);
        message.success('日报条目已创建');
      }
      setDrModalOpen(false); setEditingDr(null); drForm.resetFields(); fetchDailyReports();
    }
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

  const selectSupportPerson = async (name: string | null | undefined) => {
    const n = String(name ?? '').trim();
    setSelectedPersonName(n || null);
    setSelectedPerson(null);
    setPersonRelated(null);
    if (!n) return;
    const person = people.find(p => String(p.properties['姓名'] ?? p.properties['name'] ?? '') === n);
    if (!person) return;
    setSelectedPerson(person);
    setPersonPanelLoading(true);
    try { setPersonRelated(await api.getRelated('person', person.id, { depth: 1 })); }
    catch { setPersonRelated(null); }
    finally { setPersonPanelLoading(false); }
  };

  const handleApplyTemplate = async (templateId: string) => {
    if (!id) return;
    try {
      const result = await api.applySupportTemplate(templateId, id);
      message.success(`已应用模板，创建 ${result.applied} 个节点`);
      fetchSupportNodes();
    } catch (e: any) { message.error(e.message); }
  };

  const extraEditFields = (() => {
    const seen = new Set<string>();
    return (schema?.fields ?? []).filter(f => {
      if (f.retired || HARDCODED_EDIT_FIELDS.has(f.name) || seen.has(f.name)) return false;
      seen.add(f.name);
      return true;
    });
  })();

  const drColumns = [
    { title: '日报类型', dataIndex: 'type', width: 100 },
    { title: '当前进展', dataIndex: 'currentProgress', render: (v: string) => v.length > 120 ? v.slice(0, 120) + '…' : v },
    { title: '下一步计划', dataIndex: 'nextSteps', render: (v: string) => v ? (v.length > 80 ? v.slice(0, 80) + '…' : v) : '--' },
    { title: '状态', dataIndex: 'status', width: 80, render: (v: string) => <Tag color={v === '已发布' ? 'green' : 'default'}>{v}</Tag> },
    { title: '创建时间', dataIndex: 'createdAt', width: 150, render: (v: string) => dayjs(v).format('MM/DD HH:mm') },
    { title: '操作', width: 200, render: (_: unknown, r: DailyReportEntry) => (
      <Space size={4}>
        <Button size="small" type="link" onClick={() => setDrDetail(r)}>详情</Button>
        <Button size="small" type="link" disabled={r.status === '已发布'} onClick={() => { setEditingDr(r); drForm.setFieldsValue({ type: r.type, currentProgress: r.currentProgress, nextSteps: r.nextSteps }); setDrModalOpen(true); }}>编辑</Button>
        <Button size="small" type="link" disabled={r.status === '已发布'} onClick={async () => { if (id) { await api.publishDailyReportEntry(id, r.id); message.success('已发布'); fetchDailyReports(); } }}>发布</Button>
        <Button size="small" type="link" danger disabled={r.status === '已发布'} onClick={async () => { if (id) { await api.deleteDailyReportEntry(id, r.id); message.success('已删除'); fetchDailyReports(); } }}>删除</Button>
      </Space>
    )},
  ];

  const handleTabAdded = (newTab: TicketTab) => {
    setDynamicTabs(prev => [...prev, newTab]);
    setAddTabOpen(false);
  };

  const handleTabDeleted = (tabId: string) => {
    setDynamicTabs(prev => prev.filter(t => t.id !== tabId));
  };

  const handleTabUpdated = (updated: TicketTab) => {
    setDynamicTabs(prev => prev.map(t => t.id === updated.id ? updated : t));
  };

  const members = parseMembers(props);

  const openAddMember = () => {
    setEditingMemberIdx(null);
    memberForm.resetFields();
    memberForm.setFieldsValue({ 角色: '组员' });
    setMemberDrawerOpen(true);
  };
  const openEditMember = (idx: number) => {
    setEditingMemberIdx(idx);
    memberForm.setFieldsValue({ 姓名: members[idx].姓名, 角色: members[idx].角色 });
    setMemberDrawerOpen(true);
  };
  const submitMember = async (values: { 姓名: string; 角色: TeamRole }) => {
    const cleaned = { 姓名: String(values.姓名 ?? '').trim(), 角色: values.角色 || '组员' };
    if (!cleaned.姓名) { message.warning('请选择成员姓名'); return; }
    let next: TeamMember[];
    if (editingMemberIdx == null) {
      if (members.some(m => m.姓名 === cleaned.姓名)) { message.warning(`「${cleaned.姓名}」已在成员列表中`); return; }
      next = [...members, cleaned];
    } else {
      next = members.map((m, i) => i === editingMemberIdx ? cleaned : m);
      const dupIdx = next.findIndex((m, i) => i !== editingMemberIdx && m.姓名 === cleaned.姓名);
      if (dupIdx >= 0) { message.warning(`「${cleaned.姓名}」已在成员列表中`); return; }
    }
    await updateMembers(next);
    setMemberDrawerOpen(false);
  };
  const deleteMember = async (idx: number) => {
    await updateMembers(members.filter((_, i) => i !== idx));
  };

  // 进展 Timeline 合并:原始 progress + 过滤后的关键审计事件(状态流转/升级/合并/成员变更),按时间倒序
  const keyAudits = filterKeyAudits(auditLogs);
  type TLEntry = { ts: string; color: string; node: React.ReactNode };
  const progressTL: TLEntry[] = progress.map(p => ({
    ts: p.updatedAt,
    color: STATUS_COLOR[p.statusSnapshot] ?? 'gray',
    node: (
      <div>
        <div><Text strong>{dayjs(p.updatedAt).format('MM/DD HH:mm')}</Text> <StatusTag status={p.statusSnapshot} /></div>
        <Paragraph style={{ margin: '4px 0 0' }}>{p.content}</Paragraph>
      </div>
    ),
  }));
  const auditTL: TLEntry[] = keyAudits.map((c, i) => ({
    ts: c.entry.performedAt,
    color: c.color,
    node: (
      <div key={`a-${i}`}>
        <div>
          <Text strong>{dayjs(c.entry.performedAt).format('MM/DD HH:mm')}</Text>
          <Tag color={c.color} style={{ marginLeft: 6 }}>{c.kind}</Tag>
          {c.entry.performedBy && <Text type="secondary" style={{ marginLeft: 4 }}>· {c.entry.performedBy}</Text>}
        </div>
        <Paragraph style={{ margin: '4px 0 0' }}>{c.summary}</Paragraph>
      </div>
    ),
  }));
  const timelineItems = [...progressTL, ...auditTL]
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
    .map((e, idx) => ({ color: e.color, children: <div key={idx}>{e.node}</div> }));

  const memberColumns = [
    { title: '姓名', dataIndex: '姓名', key: '姓名', render: (v: string) => <Space><Avatar size="small" icon={<UserOutlined />} /><Text strong>{v}</Text></Space> },
    { title: '角色', dataIndex: '角色', key: '角色', width: 120, render: (v: TeamRole) => <Tag color={v === '组长' ? 'gold' : 'blue'}>{v}</Tag> },
    {
      title: '操作', key: 'op', width: 140,
      render: (_: unknown, _r: TeamMember, idx: number) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => openEditMember(idx)}>修改角色</Button>
          <Popconfirm title={`确认移除「${members[idx].姓名}」？`} onConfirm={() => deleteMember(idx)}>
            <Button type="link" size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const fixedTabItems = [
    {
      key: 'basic', label: <span><InfoCircleOutlined /> 基础信息</span>,
      children: (
        <div style={{ padding: '16px 0' }}>
          <Space style={{ marginBottom: 12 }}>
            <Popover
              trigger="click"
              placement="bottomLeft"
              content={
                <div style={{ minWidth: 220, maxHeight: 320, overflow: 'auto' }}>
                  <Checkbox.Group
                    value={basicFields.map(f => f.name).filter(n => !hiddenBasicFields.includes(n))}
                    onChange={(vals) => {
                      const visible = vals as string[];
                      setHiddenBasicFields(basicFields.map(f => f.name).filter(n => !visible.includes(n)));
                    }}
                    style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
                  >
                    {basicFields.map(f => <Checkbox key={f.name} value={f.name}>{f.label}</Checkbox>)}
                  </Checkbox.Group>
                  {hiddenBasicFields.length > 0 && (
                    <Button type="link" size="small" onClick={() => setHiddenBasicFields([])} style={{ paddingLeft: 0, marginTop: 8 }}>
                      全部恢复
                    </Button>
                  )}
                </div>
              }
            >
              <Button icon={<AppstoreOutlined />} size="small">字段管理{hiddenBasicFields.length > 0 ? `(已隐藏 ${hiddenBasicFields.length})` : ''}</Button>
            </Popover>
            <Text type="secondary" style={{ fontSize: 12 }}>勾选要显示的字段;偏好按用户保存,下次进来仍生效。</Text>
          </Space>
          <Descriptions bordered column={2} size="small" style={{ marginBottom: 24 }}>
            {basicFields.filter(f => !hiddenBasicFields.includes(f.name)).map(f => (
              <Descriptions.Item key={f.name} label={f.label}>
                {String(props[f.name] ?? '--')}
              </Descriptions.Item>
            ))}
          </Descriptions>
        </div>
      ),
    },
    {
      key: 'members', label: <span><TeamOutlined /> 成员管理</span>,
      children: (
        <div style={{ padding: '16px 0' }}>
          <Space style={{ marginBottom: 12 }}>
            <Button type="primary" icon={<PlusOutlined />} onClick={openAddMember}>添加成员</Button>
            <Text type="secondary">共 {members.length} 人 · 组长 {members.filter(m => m.角色 === '组长').length} · 组员 {members.filter(m => m.角色 === '组员').length}</Text>
          </Space>
          {members.length === 0 ? (
            <Empty description="暂无成员,点击「添加成员」开始组建团队" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            <Table size="small" rowKey={(r) => r.姓名} dataSource={members} columns={memberColumns} pagination={false} />
          )}
        </div>
      ),
    },
    {
      key: 'welink', label: <span><MessageOutlined /> Welink 消息</span>,
      children: <WelinkTab ticketId={id!} />,
    },
    {
      key: 'progress', label: <span><SwapOutlined /> 进展同步</span>,
      children: (
        <div style={{ padding: '16px 0' }}>
          <Space style={{ marginBottom: 16 }}>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setProgressOpen(true)}>追加进展</Button>
            {isLeader && (
              <Button icon={<HistoryOutlined />} onClick={() => navigate(`/audit?entityId=${id}`)}>查看完整历史</Button>
            )}
          </Space>
          {timelineItems.length === 0 ? <Empty description="暂无进展记录" image={Empty.PRESENTED_IMAGE_SIMPLE} /> : (
            <Timeline items={timelineItems} />
          )}
        </div>
      ),
    },
    {
      key: 'dailyReport', label: <span><FileTextOutlined /> 日报更新</span>,
      children: (
        <div style={{ padding: '16px 0' }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingDr(null); drForm.resetFields(); setDrModalOpen(true); }} style={{ marginBottom: 16 }}>创建</Button>
          <Table size="small" loading={drLoading} dataSource={dailyReports} columns={drColumns} rowKey="id"
            pagination={{ pageSize: 10 }} locale={{ emptyText: <Empty description="暂无日报条目" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }} />
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
            <Row gutter={16}>
              <Col span={14}>
                <Tree treeData={buildTree(supportNodes)} defaultExpandAll titleRender={(nd: any) => (
                  <Space size={8}>
                    <Tooltip title={nd.note ? `备注：${nd.note}` : '无备注'}>
                      <Space size={8} style={{ cursor: 'pointer' }} onClick={() => selectSupportPerson(nd.personName)}>
                        <Tag color="blue">{nd.category}</Tag>
                        <Text strong style={selectedPersonName && nd.personName === selectedPersonName ? { color: '#1677ff' } : undefined}>{nd.personName || '待指定'}</Text>
                        <Text type="secondary">· {nd.domain}</Text>
                        <Tag color={SUPPORT_STATUS_COLOR[nd.status] ?? 'default'}>{nd.status}</Tag>
                      </Space>
                    </Tooltip>
                    <Button size="small" type="text" icon={<EditOutlined />} onClick={e => { e.stopPropagation(); setEditingNode(nd); supportForm.setFieldsValue({ parentId: nd.parentId ?? undefined, category: nd.category, domain: nd.domain, personName: nd.personName ?? undefined, status: nd.status, note: nd.note }); setSupportModalOpen(true); }} />
                    <Popconfirm title="确认删除该节点？" onConfirm={() => handleDeleteSupportNode(nd.id)}>
                      <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={e => e.stopPropagation()} />
                    </Popconfirm>
                  </Space>
                )} />
              </Col>
              <Col span={10}>
                <Card size="small" title="负责人详情" style={{ position: 'sticky', top: 0 }}>
                  {personPanelLoading ? <Spin /> : !selectedPersonName ? (
                    <Empty description="点击左侧节点查看负责人详情与图谱关联" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  ) : !selectedPerson ? (
                    <Empty description={`未在全员名单中找到「${selectedPersonName}」`} image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  ) : (
                    <>
                      <Descriptions column={1} size="small" bordered>
                        <Descriptions.Item label="姓名">{String(selectedPerson.properties['姓名'] ?? '-')}</Descriptions.Item>
                        <Descriptions.Item label="部门">{String(selectedPerson.properties['部门'] ?? '-')}</Descriptions.Item>
                        <Descriptions.Item label="工号">{String(selectedPerson.properties['工号'] ?? '-')}</Descriptions.Item>
                        <Descriptions.Item label="邮箱">{String(selectedPerson.properties['邮箱'] ?? '-')}</Descriptions.Item>
                        <Descriptions.Item label="角色">{String(selectedPerson.properties['角色'] ?? '-')}</Descriptions.Item>
                      </Descriptions>
                      <Divider orientation="left" orientationMargin={0} style={{ marginTop: 12 }}>知识图谱关联（一跳）</Divider>
                      {(() => {
                        const items = [...(personRelated?.incoming ?? []), ...(personRelated?.outgoing ?? [])];
                        if (items.length === 0) return <Text type="secondary">暂无关联实体</Text>;
                        return (
                          <List size="small" dataSource={items}
                            renderItem={(it, i) => {
                              const p = it.node.properties;
                              const nm = String(p['标题'] ?? p['姓名'] ?? p['团队名称'] ?? p['name'] ?? nodeLabel(it.node));
                              return (
                                <List.Item key={`${it.node.id}-${i}`}>
                                  <Space size={6} wrap>
                                    <Tag color="geekblue">{it.field || it.concept || '关联'}</Tag>
                                    <Tag>{NODE_TYPE_LABEL[it.node.nodeType] ?? it.node.nodeType}</Tag>
                                    {it.node.nodeType === 'attackTicket'
                                      ? <a onClick={() => navigate(`/attack/${it.node.id}`)}>{nm}</a>
                                      : <Text>{nm}</Text>}
                                  </Space>
                                </List.Item>
                              );
                            }} />
                        );
                      })()}
                    </>
                  )}
                </Card>
              </Col>
            </Row>
          )}
        </div>
      ),
    },
  ];

  const dynamicTabItems = dynamicTabs.map(tab => ({
    key: tab.id,
    label: <span style={tab.tabType === 'custom' && tab.title === '信息广场' ? { color: '#999' } : undefined}>{tab.tabType === 'link' ? <LinkOutlined /> : <FileTextOutlined />} {tab.title}</span>,
    closable: true,
    children: tab.tabType === 'link'
      ? <DynamicLinkTab ticketId={id!} tab={tab} onDeleted={handleTabDeleted} />
      : <DynamicCustomTab ticketId={id!} tab={tab} onDeleted={handleTabDeleted} onUpdate={handleTabUpdated} />,
  }));

  const allTabItems = [
    ...fixedTabItems.map(item => ({ ...item, closable: false })),
    ...dynamicTabItems,
  ];

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Button type="link" icon={<ArrowLeftOutlined />} onClick={() => {
          const idx = (window.history.state && (window.history.state as any).idx) as number | undefined;
          if (idx && idx > 0) navigate(-1); else navigate('/attack');
        }} style={{ paddingLeft: 0 }}>返回列表</Button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Title level={4} style={{ margin: 0 }}>
              {isPrivate && <Tooltip title="私密攻关单 — 仅创建人/成员/授权人可访问"><LockOutlined style={{ color: '#fa8c16', marginRight: 6 }} /></Tooltip>}
              {title} <StatusTag status={status} />
            </Title>
            <HelpButton title={HELP.attackDetail.title} content={HELP.attackDetail.content} />
          </div>
          <Text type="secondary">创建于 {dayjs(node.createdAt).format(DATE_FORMAT)} · 更新于 {dayjs(node.updatedAt).fromNow()}</Text>
        </div>
        <Space>
          <Popover
            trigger="click"
            placement="bottomRight"
            content={
              <div style={{ minWidth: 180 }}>
                <Checkbox.Group
                  value={visibleCards}
                  onChange={(vals) => setVisibleCards(vals as string[])}
                  style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
                >
                  {SIDEBAR_CARD_OPTIONS.map(opt => (
                    <Checkbox key={opt.key} value={opt.key}>{opt.label}</Checkbox>
                  ))}
                </Checkbox.Group>
              </div>
            }
          >
            <Button icon={<AppstoreOutlined />}>面板</Button>
          </Popover>
          <Link to={`/related/attackTicket/${id}`}><Button icon={<LinkOutlined />}>关联全景</Button></Link>
          {isCreator && (
            isPrivate ? (
              <>
                <Button icon={<LockOutlined />} onClick={openPrivacyDrawer}>管理私密授权</Button>
                <Popconfirm title="确认取消私密?所有人都将能访问该攻关单" onConfirm={cancelPrivacy}>
                  <Button icon={<UnlockOutlined />}>取消私密</Button>
                </Popconfirm>
              </>
            ) : (
              <Button icon={<LockOutlined />} onClick={openPrivacyDrawer}>设置私密</Button>
            )
          )}
          <Button icon={<SwapOutlined />} onClick={() => setTransitionOpen(true)}>状态流转</Button>
          <Button icon={<EditOutlined />} onClick={() => {
            // 编辑抽屉里 攻关成员 是多选,需要把 成员列表 派生出组员姓名数组回填
            const onlyMembers = parseMembers(props).filter(m => m.角色 === '组员').map(m => m.姓名);
            editForm.setFieldsValue({ ...(props as any), 攻关成员: onlyMembers });
            setEditOpen(true);
          }}>编辑信息</Button>
          {(() => {
            // 删除按钮仅创建人本人可见;管理员/Leader 看不到;无创建人(老数据)也不显示
            const creator = String(props['创建人'] ?? '').trim();
            const canDelete = !!creator && !!auth.user?.username && creator === auth.user.username;
            return canDelete ? (
              <Popconfirm title="确认删除此攻关单？" onConfirm={handleDelete}>
                <Button danger icon={<DeleteOutlined />}>删除</Button>
              </Popconfirm>
            ) : null;
          })()}
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
        <Col span={visibleCards.length > 0 ? 18 : 24}>
          <Card styles={{ body: { padding: 0 } }}>
            <Tabs
              type="editable-card"
              hideAdd
              activeKey={undefined}
              style={{ padding: '0 16px' }}
              items={allTabItems}
              onEdit={(targetKey, action) => {
                if (action === 'add') setAddTabOpen(true);
                if (action === 'remove' && typeof targetKey === 'string') {
                  const tab = dynamicTabs.find(t => t.id === targetKey);
                  if (tab) {
                    Modal.confirm({
                      title: '删除标签',
                      content: '不再保存，确认后将永久删除此标签。',
                      okText: '确认删除',
                      okType: 'danger',
                      cancelText: '取消',
                      onOk: async () => {
                        try {
                          await api.deleteTicketTab(id!, targetKey);
                          handleTabDeleted(targetKey);
                        } catch (e: any) {
                          message.error('删除标签失败: ' + e.message);
                        }
                      },
                    });
                  }
                }
              }}
              tabBarExtraContent={
                <Button size="small" icon={<PlusOutlined />} onClick={() => setAddTabOpen(true)}>添加标签</Button>
              }
            />
          </Card>
        </Col>
        {visibleCards.length > 0 && <Col span={6}>
          {visibleCards.includes('helpers') && helpers.length > 0 && (
            <Card
              title="找帮手推荐"
              size="small"
              style={{ marginBottom: 16 }}
              extra={
                <Space size={4}>
                  <Tag>{helpers.length}人</Tag>
                  <Button type="text" size="small" icon={<CloseOutlined />} onClick={() => setVisibleCards(prev => prev.filter(k => k !== 'helpers'))} />
                </Space>
              }
            >
              <List size="small" dataSource={helpers} renderItem={(h, i) => (
                <List.Item style={{ padding: '6px 0' }}>
                  <Space>
                    <Tag color={i === 0 ? 'gold' : i === 1 ? '#c0c0c0' : i === 2 ? '#cd7f32' : 'default'}>#{i + 1}</Tag>
                    <Avatar size="small" icon={<UserOutlined />} />
                    <Text strong>{(h.person.properties['姓名'] as string) ?? nodeLabel(h.person)}</Text>
                    <Text type="secondary">{h.score}分</Text>
                  </Space>
                </List.Item>
              )} />
            </Card>
          )}
          {visibleCards.includes('audit') && isLeader && (
            <Card
              title="合规追溯"
              size="small"
              style={{ marginBottom: 16 }}
              extra={
                <Space size={4}>
                  <HistoryOutlined />
                  <Button type="text" size="small" icon={<CloseOutlined />} onClick={() => setVisibleCards(prev => prev.filter(k => k !== 'audit'))} />
                </Space>
              }
            >
              {isAdmin && keyAudits.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>最近关键事件</Text>
                  <List
                    size="small"
                    dataSource={keyAudits.slice(0, 3)}
                    renderItem={(c) => (
                      <List.Item style={{ padding: '4px 0' }}>
                        <Space size={6}>
                          <Tag color={c.color} style={{ margin: 0 }}>{c.kind}</Tag>
                          <Text style={{ fontSize: 12 }}>{c.summary}</Text>
                          <Text type="secondary" style={{ fontSize: 11 }}>{dayjs(c.entry.performedAt).format('MM/DD HH:mm')}</Text>
                        </Space>
                      </List.Item>
                    )}
                  />
                </div>
              )}
              <Button type="link" icon={<HistoryOutlined />} onClick={() => navigate(`/audit?entityId=${id}`)} style={{ paddingLeft: 0 }}>
                查看完整历史 →
              </Button>
            </Card>
          )}
        </Col>}
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
          <Form.Item name="攻关成员" label="攻关成员" tooltip="多选组员;组长在上方选,不要重复">
            <Select mode="multiple" showSearch allowClear placeholder="从全员名单多选组员" options={personOptions} filterOption={(input, option) => (option?.label as string)?.toLowerCase().includes(input.toLowerCase())} />
          </Form.Item>
          <Form.Item name="攻关申请人" label="攻关申请人"><Select showSearch allowClear placeholder="搜索人员" options={personOptions} filterOption={(input, option) => (option?.label as string)?.toLowerCase().includes(input.toLowerCase())} /></Form.Item>
          <Divider orientation="left" orientationMargin={0}>详细信息</Divider>
          <Form.Item name="影响及现存风险" label="影响及现存风险"><Input.TextArea rows={3} /></Form.Item>
          <Form.Item name="资源ID" label="资源ID"><Input /></Form.Item>
          <Form.Item name="租户ID" label="租户ID"><Input /></Form.Item>
          {extraEditFields.length > 0 && (
            <>
              <Divider orientation="left" orientationMargin={0}>其它字段</Divider>
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

      <Drawer
        title={isPrivate ? '管理私密授权' : '设置私密'}
        width={520}
        open={privacyDrawerOpen}
        onClose={() => setPrivacyDrawerOpen(false)}
        destroyOnClose
        maskClosable={false}
        extra={<Button type="primary" onClick={() => privacyForm.submit()}>{isPrivate ? '保存' : '设为私密'}</Button>}
      >
        <Alert
          type="info"
          showIcon
          message="私密攻关单的访问规则"
          description={<div>
            <div>• 创建人本人 + 成员管理 tab 内的所有成员(组长 / 组员)默认可访问</div>
            <div>• 额外指定的人员/邮件群组(下方两个多选)也将获得访问权限</div>
            <div>• 列表里会在标题前显示 🔒 提醒</div>
          </div>}
          style={{ marginBottom: 16 }}
        />
        <Form form={privacyForm} layout="vertical" onFinish={submitPrivacy}>
          <Form.Item name="授权人" label="指定授权人员" tooltip="支持搜索快速定位;成员无需在此重复添加">
            <Select
              mode="multiple"
              showSearch
              allowClear
              placeholder="从全员名单多选(可搜索姓名/部门)"
              options={personOptions}
              filterOption={(input, option) => (option?.label as string)?.toLowerCase().includes(input.toLowerCase())}
            />
          </Form.Item>
          <Form.Item name="授权组" label="指定授权邮件群组" tooltip="选中后该群组所有成员邮箱对应的人都可访问">
            <Select
              mode="multiple"
              showSearch
              allowClear
              placeholder="从邮件群组多选(可搜索组名)"
              options={emailGroups.map(g => ({
                value: String(g.properties['组名'] ?? ''),
                label: `${g.properties['组名'] ?? '-'} ${g.properties['描述'] ? `(${g.properties['描述']})` : ''}`,
              }))}
              filterOption={(input, option) => (option?.label as string)?.toLowerCase().includes(input.toLowerCase())}
            />
          </Form.Item>
        </Form>
      </Drawer>

      <Drawer
        title={editingMemberIdx == null ? '添加成员' : '修改成员角色'}
        width={400}
        open={memberDrawerOpen}
        onClose={() => setMemberDrawerOpen(false)}
        destroyOnClose
        maskClosable={false}
        extra={<Button type="primary" onClick={() => memberForm.submit()}>{editingMemberIdx == null ? '添加' : '保存'}</Button>}
      >
        <Form form={memberForm} layout="vertical" onFinish={submitMember} initialValues={{ 角色: '组员' }}>
          <Form.Item name="姓名" label="姓名" rules={[{ required: true, message: '请选择成员' }]}>
            <Select
              showSearch
              allowClear
              placeholder="从全员名单搜索"
              disabled={editingMemberIdx != null}
              options={personOptions}
              filterOption={(input, option) => (option?.label as string)?.toLowerCase().includes(input.toLowerCase())}
            />
          </Form.Item>
          <Form.Item name="角色" label="角色" rules={[{ required: true, message: '请选择角色' }]}>
            <Select options={ROLE_OPTIONS.map(r => ({ value: r, label: r }))} />
          </Form.Item>
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

      <Modal title={editingDr ? '编辑日报条目' : '创建日报条目'} open={drModalOpen} onCancel={() => { setDrModalOpen(false); setEditingDr(null); }} footer={null} destroyOnClose>
        <Form form={drForm} layout="vertical" initialValues={{ type: '进展通报' }} onFinish={createDailyReport}>
          <Form.Item name="type" label="日报类型"><Select options={DR_TYPES.map(t => ({ value: t, label: t }))} /></Form.Item>
          <Form.Item name="currentProgress" label="当前进展" rules={[{ required: true, message: '当前进展必填' }]}><Input.TextArea rows={4} placeholder="请输入当前进展..." /></Form.Item>
          <Form.Item name="nextSteps" label="下一步计划"><Input.TextArea rows={3} placeholder="请输入下一步计划..." /></Form.Item>
          <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}><Space><Button onClick={() => { setDrModalOpen(false); setEditingDr(null); }}>取消</Button><Button type="primary" htmlType="submit" loading={drSubmitting}>提交</Button></Space></Form.Item>
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
          <Form.Item name="parentId" label="上级节点（求助对象/人）"><Select allowClear placeholder="选择上级求助对象" options={supportNodes.filter(sn => !editingNode || sn.id !== editingNode.id).map(sn => ({ value: sn.id, label: `${sn.personName || '待指定'}（${sn.domain}）` }))} /></Form.Item>
          <Form.Item name="category" label="大类" rules={[{ required: true, message: '请选择大类' }]}><Select placeholder="选择大类" options={SUPPORT_CATEGORIES.map(c => ({ value: c, label: c }))} /></Form.Item>
          <Form.Item name="domain" label="具体领域" rules={[{ required: true, message: '请输入具体领域' }]}><Input placeholder="请输入具体领域" /></Form.Item>
          <Form.Item name="personName" label="负责人姓名（可选）"><Select showSearch allowClear placeholder="从全员名单搜索" options={personOptions} filterOption={(input, option) => (option?.label as string)?.toLowerCase().includes(input.toLowerCase())} /></Form.Item>
          <Form.Item name="status" label="状态" initialValue="待确认"><Select options={SUPPORT_STATUSES.map(s => ({ value: s, label: s }))} /></Form.Item>
          <Form.Item name="note" label="备注"><Input.TextArea rows={3} placeholder="备注..." /></Form.Item>
          <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}><Space><Button onClick={() => { setSupportModalOpen(false); setEditingNode(null); }}>取消</Button><Button type="primary" htmlType="submit" loading={supportSubmitting}>提交</Button></Space></Form.Item>
        </Form>
      </Modal>

      <AddTabModal ticketId={id!} open={addTabOpen} onClose={() => setAddTabOpen(false)} onCreated={handleTabAdded} />
    </div>
  );
}
