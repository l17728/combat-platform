import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Table, Button, Space, Input, Select, Drawer, Form, message, Popconfirm, Typography, Skeleton, Tooltip, Divider, Checkbox, Popover, Tabs,
} from 'antd';
import { PlusOutlined, ExportOutlined, SearchOutlined, SettingOutlined, StarOutlined, StarFilled, LockOutlined } from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { PAGE_SIZE, PAGE_SIZE_OPTIONS } from '../constants.js';
import StatusTag from '../components/StatusTag.js';
import { useSettings } from '../hooks/useSettings.js';
import { useAuth } from '../hooks/useAuth.js';
import { useFlexTable, FlexHeaderCell } from '../hooks/useFlexTable.js';
import type { GraphNode, NodeSchema } from '@combat/shared';
import HelpButton from '../components/HelpButton.js';
import HELP from '../help-content.js';
import { buildMembersFromForm, syncMemberFields } from '../utils/teamMembers.js';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const { Title, Text } = Typography;
// 攻关成员/成员列表 由专用多选框 + 成员管理 tab 维护,不能让通用 extraFields 渲染成单行 Input
const HARDCODED_FIELDS = new Set(['标题', '状态', '事件级别', '客户名称', '问题单号', '事件单号', '当前处理人', '攻关组长', '攻关申请人', '影响及现存风险', '资源ID', '租户ID', '攻关成员', '成员列表', '创建人', '私密', '私密授权人', '私密授权组']);
const DEFAULT_INFO_SQUARE_CONTENT = '# 信息广场\n\n在这里记录本攻关单的关键信息、决策记录、外部沟通要点等。\n';

const STORAGE_KEY = 'attack-list-visible-columns';
const DEFAULT_VISIBLE = ['标题', '状态', '当前处理人', '事件级别', '问题单号', '客户名称'];
// 关注列表按用户隔离:同浏览器换账号互不串扰
const favKey = (username?: string) => `combat-attack-favorites:${username || 'guest'}`;

export default function AttackList() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [schema, setSchema] = useState<NodeSchema | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterField, setFilterField] = useState<string | undefined>(() => searchParams.get('field') || undefined);
  const [filterValues, setFilterValues] = useState<string[]>(() => searchParams.getAll('val'));
  const [searchText, setSearchText] = useState(() => searchParams.get('q') || '');
  const [activeTab, setActiveTab] = useState<'all' | 'favorites'>(() =>
    searchParams.get('tab') === 'favorites' ? 'favorites' : 'all');
  const { user } = useAuth();
  const currentKey = useMemo(() => favKey(user?.username), [user]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  // 用户切换时从对应 key 重新加载关注列表(避免串账号)
  useEffect(() => {
    try { setFavorites(new Set(JSON.parse(localStorage.getItem(currentKey) || '[]'))); }
    catch { setFavorites(new Set()); }
  }, [currentKey]);
  useEffect(() => { try { localStorage.setItem(currentKey, JSON.stringify([...favorites])); } catch { /* ignore */ } }, [favorites, currentKey]);
  const toggleFavorite = useCallback((id: string) => {
    setFavorites((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }, []);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [people, setPeople] = useState<GraphNode[]>([]);
  const [exporting, setExporting] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : DEFAULT_VISIBLE;
    } catch { return DEFAULT_VISIBLE; }
  });
  const { getValues } = useSettings();

  const STATUS_OPTIONS = getValues('状态', ['待响应', '处理中', '进行中', '已解决', '已关闭']);
  const LEVEL_OPTIONS = getValues('事件级别', ['P1', 'P2', 'P3', 'P4', 'P4A', 'P4B']);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [nodeList, schemaData] = await Promise.all([
        api.listNodes('attackTicket'),
        api.getSchema('attackTicket'),
      ]);
      setNodes(nodeList);
      setSchema(schemaData);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { api.listNodes('person').then(setPeople).catch(() => {}); }, []);

  // CommandPalette / 深链 ?new=1 一键打开新建抽屉
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setDrawerOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete('new');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const fieldOptions = useMemo(() => {
    if (!schema) return [];
    return schema.fields
      .filter(f => !f.retired)
      .map(f => ({ value: f.name, label: f.label || f.name }));
  }, [schema]);

  const uniqueValues = useMemo(() => {
    if (!filterField) return [];
    const seen = new Set<string>();
    for (const n of nodes) {
      const v = n.properties[filterField];
      if (v != null && v !== '') {
        const s = String(v);
        if (!seen.has(s)) seen.add(s);
      }
    }
    return [...seen].sort();
  }, [filterField, nodes]);

  const filteredNodes = useMemo(() => {
    let result = activeTab === 'favorites' ? nodes.filter((n) => favorites.has(n.id)) : nodes;
    if (filterField && filterValues.length > 0) {
      result = result.filter(n => {
        const v = n.properties[filterField];
        return v != null && filterValues.includes(String(v));
      });
    }
    if (searchText) {
      const s = searchText.toLowerCase();
      result = result.filter(n => {
        const p = n.properties;
        return (
          (p['标题'] as string)?.toLowerCase().includes(s) ||
          (p['问题单号'] as string)?.toLowerCase().includes(s) ||
          (p['当前处理人'] as string)?.toLowerCase().includes(s) ||
          (p['客户名称'] as string)?.toLowerCase().includes(s)
        );
      });
    }
    return result;
  }, [nodes, filterField, filterValues, searchText, activeTab, favorites]);

  // Keep filters in the URL so returning from a detail page (browser back)
  // restores the search/filter instead of dumping the user on the full list.
  useEffect(() => {
    const next = new URLSearchParams();
    if (filterField) next.set('field', filterField);
    filterValues.forEach((v) => next.append('val', v));
    if (searchText) next.set('q', searchText);
    setSearchParams(next, { replace: true });
  }, [filterField, filterValues, searchText, setSearchParams]);

  const personOptions = people.map((p) => ({
    value: (p.properties['姓名'] as string) ?? '',
    label: `${p.properties['姓名'] ?? p.id} (${p.properties['部门'] ?? '-'})`,
  }));

  const handleCreate = async (values: Record<string, unknown>) => {
    setSubmitting(true);
    try {
      // 表单里 攻关组长(单选) + 攻关成员(多选姓名数组)各自录入一次,
      // 此处自动合并出 成员列表 (含角色) + 派生回 攻关组长/攻关成员 字符串,用户不必重复。
      const memberNames = Array.isArray(values['攻关成员']) ? (values['攻关成员'] as string[]) : [];
      const leader = typeof values['攻关组长'] === 'string' ? (values['攻关组长'] as string) : '';
      const members = buildMembersFromForm(leader, memberNames);
      const synced = syncMemberFields(members);
      const payload = { ...values, ...synced };
      const node = await api.createNode('attackTicket', payload);
      // 创建后自动挂一个「信息广场」自定义 tab,作为该攻关单的固定写作区域;失败不阻断创建。
      try {
        await api.createTicketTab(node.id, {
          tabType: 'custom',
          title: '信息广场',
          content: DEFAULT_INFO_SQUARE_CONTENT,
        });
      } catch { /* ignore — 用户可手动添加 */ }
      message.success('创建成功');
      setDrawerOpen(false);
      form.resetFields();
      navigate(`/attack/${node.id}`);
    } catch (e: any) { message.error(e.message); } finally { setSubmitting(false); }
  };

  const handleDelete = async (id: string) => {
    try { await api.deleteNode(id); message.success('删除成功'); fetchData(); }
    catch (e: any) { message.error(e.message); }
  };

  // 批量删除:仅删除当前用户为「创建人」的行,其它行静默跳过(避免悄悄越权)
  const handleBatchDelete = async () => {
    const ids = new Set(selectedRowKeys.map(String));
    const targets = nodes.filter((n) => ids.has(n.id));
    const me = (user?.username || '').trim();
    const deletable = targets.filter((n) => {
      const creator = String(n.properties['创建人'] ?? '').trim();
      return creator && me && creator === me;
    });
    const skipped = targets.length - deletable.length;
    if (deletable.length === 0) {
      message.warning(skipped > 0 ? `选中的 ${skipped} 条均非本人创建,无法删除` : '请先选择需要删除的攻关单');
      return;
    }
    setBatchDeleting(true);
    let ok = 0; let fail = 0;
    for (const n of deletable) {
      try { await api.deleteNode(n.id); ok++; } catch { fail++; }
    }
    setBatchDeleting(false);
    setSelectedRowKeys([]);
    if (ok > 0) message.success(`已删除 ${ok} 条${fail ? ',失败 ' + fail : ''}${skipped ? ',跳过非本人创建 ' + skipped : ''}`);
    else message.error('批量删除失败');
    fetchData();
  };

  const handleBatchFavorite = () => {
    if (selectedRowKeys.length === 0) { message.warning('请先选择需要关注的攻关单'); return; }
    setFavorites((prev) => {
      const next = new Set(prev);
      selectedRowKeys.forEach((k) => next.add(String(k)));
      return next;
    });
    message.success(`已加入关注 ${selectedRowKeys.length} 条`);
    setSelectedRowKeys([]);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const blob = await api.exportNodes('attackTicket');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `攻关单_${dayjs().format('YYYYMMDD')}.xlsx`; a.click();
      URL.revokeObjectURL(url);
      message.success('导出成功');
    } catch (e: any) { message.error(e.message); } finally { setExporting(false); }
  };

  const extraFields = useMemo(() => {
    const seen = new Set<string>();
    return (schema?.fields ?? []).filter(f => {
      if (f.retired || HARDCODED_FIELDS.has(f.name) || seen.has(f.name)) return false;
      seen.add(f.name);
      return true;
    });
  }, [schema]);

  const columnOptions = useMemo(() => {
    if (!schema) return [];
    return schema.fields
      .filter(f => !f.retired)
      .map(f => ({ value: f.name, label: f.label || f.name }));
  }, [schema]);

  const handleVisibleColumnsChange = (checked: string[]) => {
    setVisibleColumns(checked);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(checked)); } catch {}
  };

  const columns = useMemo(() => {
    const favCol = {
      key: '__fav', title: '★', width: 44, align: 'center' as const, fixed: 'left' as const,
      render: (_: unknown, r: GraphNode) => (
        <span
          onClick={(e) => { e.stopPropagation(); toggleFavorite(r.id); }}
          style={{ cursor: 'pointer', fontSize: 14 }}
          title={favorites.has(r.id) ? '取消关注' : '关注'}
        >
          {favorites.has(r.id) ? <StarFilled style={{ color: '#fadb14' }} /> : <StarOutlined style={{ color: '#bfbfbf' }} />}
        </span>
      ),
    };
    const idCol = {
      key: 'id', title: '编号', width: 90, fixed: 'left' as const,
      render: (_: unknown, r: GraphNode) => (
        <Tooltip title={r.id}><a onClick={() => navigate(`/attack/${r.id}`)}>{r.id.slice(0, 8)}</a></Tooltip>
      ),
    };

    const fieldColMap: Record<string, Record<string, unknown>> = {
      '标题': {
        key: '标题', title: '标题', dataIndex: ['properties', '标题'], ellipsis: true,
        render: (text: string, r: GraphNode) => {
          const isPrivate = String(r.properties['私密'] ?? '') === '是';
          return (
            <a onClick={() => navigate(`/attack/${r.id}`)}>
              {isPrivate && <Tooltip title="私密攻关单"><LockOutlined style={{ color: '#fa8c16', marginRight: 6 }} /></Tooltip>}
              {text || '-'}
            </a>
          );
        },
        sorter: (a: GraphNode, b: GraphNode) => ((a.properties['标题'] as string) ?? '').localeCompare((b.properties['标题'] as string) ?? ''),
      },
      '状态': {
        key: '状态', title: '状态', dataIndex: ['properties', '状态'], width: 100,
        render: (v: string) => <StatusTag status={v} />,
        sorter: (a: GraphNode, b: GraphNode) => ((a.properties['状态'] as string) ?? '').localeCompare((b.properties['状态'] as string) ?? ''),
      },
      '当前处理人': { key: '处理人', title: '处理人', dataIndex: ['properties', '当前处理人'], width: 100, ellipsis: true },
      '事件级别': { key: '事件级别', title: '事件级别', dataIndex: ['properties', '事件级别'], width: 80 },
      '问题单号': { key: '问题单号', title: '问题单号', dataIndex: ['properties', '问题单号'], width: 120, ellipsis: true },
      '客户名称': { key: '客户', title: '客户', dataIndex: ['properties', '客户名称'], width: 120, ellipsis: true },
    };

    const dataCols = visibleColumns
      .filter(name => fieldColMap[name])
      .map(name => fieldColMap[name]);

    const dynamicCols = visibleColumns
      .filter(name => !fieldColMap[name])
      .map(name => {
        const f = schema?.fields.find(fd => fd.name === name && !fd.retired);
        return {
          key: name,
          title: f?.label || name,
          dataIndex: ['properties', name],
          width: 120,
          ellipsis: true,
          render: (v: unknown) => {
            if (v == null) return '-';
            if (f?.type === 'datetime') return <Tooltip title={String(v)}>{dayjs(String(v)).format('MM-DD HH:mm')}</Tooltip>;
            if (f?.type === 'date') return dayjs(String(v)).format('YYYY-MM-DD');
            return String(v);
          },
        };
      });

    const updateCol = {
      key: '更新', title: '更新', dataIndex: 'updatedAt', width: 100,
      render: (v: string) => <Tooltip title={dayjs(v).format('YYYY-MM-DD HH:mm')}>{dayjs(v).fromNow()}</Tooltip>,
      sorter: (a: GraphNode, b: GraphNode) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime(),
      defaultSortOrder: 'descend' as const,
    };

    const opsCol = {
      key: '操作', title: '操作', width: 80, fixed: 'right' as const,
      render: (_: unknown, r: GraphNode) => {
        // 仅创建人本人能看到删除按钮(管理员也不行);老数据无创建人则隐藏
        const creator = String(r.properties['创建人'] ?? '').trim();
        const canDelete = !!creator && !!user?.username && creator === user.username;
        if (!canDelete) return <Text type="secondary" style={{ fontSize: 12 }}>—</Text>;
        return (
          <Popconfirm title={`确认删除「${r.properties['标题'] ?? '(未命名)'}」？`} onConfirm={() => handleDelete(r.id)}>
            <a style={{ color: '#ff4d4f' }}>删除</a>
          </Popconfirm>
        );
      },
    };

    return [favCol, idCol, ...dataCols, ...dynamicCols, updateCol, opsCol];
  }, [visibleColumns, schema, navigate, handleDelete, favorites, toggleFavorite, user]);

  const { columns: flexCols, FlexWrapper } = useFlexTable('attackTicket', columns);

  const tableComponents = useMemo(() => ({
    header: { cell: FlexHeaderCell },
  }), []);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Title level={4} style={{ margin: 0 }}>攻关作战台</Title>
          <HelpButton title={HELP.attackList.title} content={HELP.attackList.content} />
        </div>
        <Space>
          <Button icon={<PlusOutlined />} type="primary" onClick={() => setDrawerOpen(true)}>新建攻关</Button>
          <Button icon={<ExportOutlined />} onClick={handleExport} loading={exporting}>导出</Button>
        </Space>
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={(k) => setActiveTab(k as 'all' | 'favorites')}
        style={{ marginBottom: 8 }}
        items={[
          { key: 'all', label: '全部' },
          { key: 'favorites', label: <span><StarFilled style={{ color: '#fadb14' }} /> 我的关注{favorites.size > 0 ? ` (${favorites.size})` : ''}</span> },
        ]}
      />

      <Space style={{ marginBottom: 16 }} wrap>
        <Select placeholder="选择筛选字段" allowClear style={{ width: 160 }} value={filterField}
          onChange={(v) => { setFilterField(v); setFilterValues([]); }}
          options={fieldOptions} />
        {filterField && uniqueValues.length > 0 && (
          <Checkbox.Group value={filterValues} onChange={(v) => setFilterValues(v as string[])}
            options={uniqueValues.map(val => ({ label: val, value: val }))}
            style={{ display: 'inline-flex', flexWrap: 'wrap', gap: '4px 12px', maxHeight: 80, overflowY: 'auto', padding: '4px 0' }} />
        )}
        <Input placeholder="搜索标题/单号/处理人" prefix={<SearchOutlined />} style={{ width: 260 }}
          value={searchText} onChange={(e) => setSearchText(e.target.value)} allowClear />
        <Popover
          title="选择显示列"
          trigger="click"
          placement="bottomRight"
          content={(
            <div style={{ maxHeight: 360, overflowY: 'auto', minWidth: 200 }}>
              <div style={{ marginBottom: 8 }}>
                <Button type="link" size="small" onClick={() => handleVisibleColumnsChange(columnOptions.map(o => o.value))}>全选</Button>
                <Button type="link" size="small" onClick={() => handleVisibleColumnsChange(DEFAULT_VISIBLE)}>重置默认</Button>
              </div>
              <Checkbox.Group
                value={visibleColumns}
                onChange={(v) => handleVisibleColumnsChange(v as string[])}
                options={columnOptions}
                style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
              />
            </div>
          )}
        >
          <Button icon={<SettingOutlined />} />
        </Popover>
      </Space>

      {selectedRowKeys.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#e6f4ff',
            border: '1px solid #91caff',
            borderRadius: 6,
            padding: '6px 12px',
            marginBottom: 12,
          }}
        >
          <Text>已选 <b>{selectedRowKeys.length}</b> 条</Text>
          <Space>
            <Button size="small" icon={<StarOutlined />} onClick={handleBatchFavorite}>批量加关注</Button>
            <Popconfirm
              title={`确认删除选中的 ${selectedRowKeys.length} 条?仅本人创建的会被删除`}
              onConfirm={handleBatchDelete}
            >
              <Button size="small" danger loading={batchDeleting}>批量删除(仅创建人)</Button>
            </Popconfirm>
            <Button size="small" type="link" onClick={() => setSelectedRowKeys([])}>取消选择</Button>
          </Space>
        </div>
      )}

      {loading ? <Skeleton active paragraph={{ rows: 6 }} /> : (
        <FlexWrapper>
          <Table rowKey="id" dataSource={filteredNodes} columns={flexCols}
            components={tableComponents}
            scroll={{ x: true }}
            rowSelection={{
              selectedRowKeys,
              onChange: (keys) => setSelectedRowKeys(keys),
              columnWidth: 40,
              fixed: true,
            }}
            pagination={{ pageSize: PAGE_SIZE, showSizeChanger: true, pageSizeOptions: PAGE_SIZE_OPTIONS, showTotal: (t) => `共 ${t} 条` }}
            size="middle"
            onRow={(r) => ({
              onClick: (e) => {
                const tag = (e.target as HTMLElement).tagName;
                // 选择 checkbox 时不要触发跳转
                if (tag === 'A' || tag === 'INPUT' || (e.target as HTMLElement).closest('.ant-checkbox-wrapper')) return;
                navigate(`/attack/${r.id}`);
              },
              // 已关注的行整行底色淡黄 + 左侧金色细条,在「全部」里一眼可辨;不删除、仅标记。
              style: { cursor: 'pointer', ...(favorites.has(r.id) ? { background: '#fffbe6', boxShadow: 'inset 3px 0 0 #fadb14' } : {}) },
            })}
          />
        </FlexWrapper>
      )}

      <Drawer title="新建攻关任务" width={520} open={drawerOpen} onClose={() => { setDrawerOpen(false); form.resetFields(); }} destroyOnClose maskClosable={false}
        extra={<Button type="primary" loading={submitting} onClick={() => form.submit()}>创建</Button>}>
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="标题" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input placeholder="攻关任务标题" />
          </Form.Item>
          <Form.Item name="状态" label="状态" initialValue="待响应">
            <Select options={STATUS_OPTIONS.map((s) => ({ value: s, label: s }))} />
          </Form.Item>
          <Divider orientation="left" orientationMargin={0}>基本信息</Divider>
          <Form.Item name="事件级别" label="事件级别">
            <Select allowClear placeholder="选择事件级别" options={LEVEL_OPTIONS.map((v) => ({ value: v, label: v }))} />
          </Form.Item>
          <Form.Item name="客户名称" label="客户名称"><Input placeholder="客户名称" /></Form.Item>
          <Form.Item name="问题单号" label="问题单号"><Input placeholder="问题单号" /></Form.Item>
          <Form.Item name="事件单号" label="事件单号"><Input placeholder="事件单号" /></Form.Item>
          <Divider orientation="left" orientationMargin={0}>人员</Divider>
          <Form.Item name="当前处理人" label="当前处理人">
            <Select showSearch allowClear placeholder="从全员名单搜索" options={personOptions}
              filterOption={(input, option) => (option?.label as string)?.toLowerCase().includes(input.toLowerCase())} />
          </Form.Item>
          <Form.Item name="攻关组长" label="攻关组长">
            <Select showSearch allowClear placeholder="从全员名单搜索" options={personOptions}
              filterOption={(input, option) => (option?.label as string)?.toLowerCase().includes(input.toLowerCase())} />
          </Form.Item>
          <Form.Item name="攻关成员" label="攻关成员" tooltip="多选,组员角色;组长在上面单选,不必在此重复选择">
            <Select mode="multiple" showSearch allowClear placeholder="从全员名单多选组员" options={personOptions}
              filterOption={(input, option) => (option?.label as string)?.toLowerCase().includes(input.toLowerCase())} />
          </Form.Item>
          <Form.Item name="攻关申请人" label="攻关申请人">
            <Select showSearch allowClear placeholder="从全员名单搜索" options={personOptions}
              filterOption={(input, option) => (option?.label as string)?.toLowerCase().includes(input.toLowerCase())} />
          </Form.Item>
          <Divider orientation="left" orientationMargin={0}>详细信息</Divider>
          <Form.Item name="影响及现存风险" label="影响及现存风险"><Input.TextArea rows={3} placeholder="描述影响及风险" /></Form.Item>
          <Form.Item name="资源ID" label="资源ID"><Input placeholder="资源ID" /></Form.Item>
          <Form.Item name="租户ID" label="租户ID"><Input placeholder="租户ID" /></Form.Item>
          {extraFields.length > 0 && (
            <>
              <Divider orientation="left" orientationMargin={0}>其它字段</Divider>
              {extraFields.map(f => (
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
    </div>
  );
}
