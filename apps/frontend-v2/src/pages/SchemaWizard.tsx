import { useEffect, useState, useCallback } from 'react';
import {
  Table, Input, Select, Button, List, Tag, message, Card, Space, Typography, Row, Col, Divider, Popconfirm, Popover, Tooltip,
} from 'antd';
import { PlusOutlined, DeleteOutlined, SearchOutlined, CheckOutlined, LinkOutlined, DisconnectOutlined } from '@ant-design/icons';
import type { FieldSchema, FieldType, NodeSchema } from '@combat/shared';
import { api } from '../api.js';
import type { SchemaSuggestion } from '../api.js';
import { useSettings } from '../hooks/useSettings.js';
import HelpButton from '../components/HelpButton.js';
import HELP from '../help-content.js';

const { Title, Text } = Typography;

const FIELD_TYPE_OPTIONS: { value: FieldType; label: string }[] = [
  { value: 'string', label: '文本 (string)' },
  { value: 'number', label: '数字 (number)' },
  { value: 'date', label: '日期 (date)' },
  { value: 'datetime', label: '日期时间 (datetime)' },
  { value: 'enum', label: '枚举 (enum)' },
  { value: 'ref', label: '引用 ref' },
  { value: 'sequence', label: '序号 (sequence)' },
];

interface FieldRow {
  key: string;
  name: string;
  label: string;
  type: FieldType;
  refType?: string;
  enumValues?: string[];
  concept?: string;
  anchor?: string;
  optionsKey?: string;
}

function SuggestPopover({ fieldName, onReuse }: { fieldName: string; onReuse: (s: SchemaSuggestion) => void }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<SchemaSuggestion[]>([]);

  const handleOpen = useCallback(async (visible: boolean) => {
    setOpen(visible);
    if (visible && fieldName.trim()) {
      setLoading(true);
      try {
        setSuggestions(await api.suggestSchema(fieldName));
      } catch { setSuggestions([]); }
      finally { setLoading(false); }
    }
  }, [fieldName]);

  return (
    <Popover
      content={
        <div style={{ maxWidth: 400, maxHeight: 300, overflowY: 'auto' }}>
          {loading ? <Text type="secondary">搜索中…</Text>
            : suggestions.length === 0 ? <Text type="secondary">无匹配字段</Text>
            : (
              <List size="small" dataSource={suggestions}
                renderItem={(s) => (
                  <List.Item actions={[
                    <Button key="reuse" size="small" icon={<CheckOutlined />}
                      onClick={() => { onReuse(s); setOpen(false); }}>复用</Button>,
                  ]}>
                    <List.Item.Meta
                      title={<Space size={4}><Text strong>{s.label}</Text><Tag color="blue">{s.nodeType}</Tag></Space>}
                      description={<Text type="secondary" style={{ fontSize: 12 }}>
                        类型: {s.type}{s.concept ? ` 概念: ${s.concept}` : ''}{s.anchor ? ` 锚: ${s.anchor}` : ''}
                      </Text>} />
                  </List.Item>
                )} />
            )}
        </div>
      }
      title={`"${fieldName}" 的现有字段匹配`}
      trigger="click" open={open} onOpenChange={handleOpen}
    >
      <Button size="small" icon={<SearchOutlined />}>查找现有字段</Button>
    </Popover>
  );
}

export default function SchemaWizard() {
  const [schemas, setSchemas] = useState<NodeSchema[]>([]);
  const [selectedSchema, setSelectedSchema] = useState<NodeSchema | null>(null);
  const [loadingSchemas, setLoadingSchemas] = useState(false);
  const [nodeType, setNodeType] = useState('');
  const [tableLabel, setTableLabel] = useState('');
  const [fieldRows, setFieldRows] = useState<FieldRow[]>([{ key: '0', name: '', label: '', type: 'string' }]);
  const [submitting, setSubmitting] = useState(false);
  const { settings } = useSettings();
  const settingKeys = Object.keys(settings).filter(k => !k.includes('.'));

  const loadSchemas = useCallback(async () => {
    setLoadingSchemas(true);
    try { setSchemas(await api.listSchemas()); }
    catch { setSchemas([]); }
    finally { setLoadingSchemas(false); }
  }, []);

  useEffect(() => { loadSchemas(); }, [loadSchemas]);

  const addFieldRow = () => setFieldRows(prev => [...prev, { key: String(Date.now()), name: '', label: '', type: 'string' }]);
  const removeFieldRow = (key: string) => setFieldRows(prev => prev.filter(r => r.key !== key));
  const updateFieldRow = (key: string, patch: Partial<FieldRow>) => setFieldRows(prev => prev.map(r => r.key === key ? { ...r, ...patch } : r));

  const handleReuseConceptFor = (key: string, s: SchemaSuggestion) => {
    updateFieldRow(key, { name: s.fieldName, type: s.type as FieldType, concept: s.concept, anchor: s.anchor, label: s.label });
    message.success(`已复用 "${s.label}" 的概念/锚点`);
  };

  const handleSubmit = async () => {
    if (!nodeType.trim() || !/^[a-zA-Z][a-zA-Z0-9]*$/.test(nodeType)) {
      message.error('表名必须以字母开头，只包含字母和数字');
      return;
    }
    if (!tableLabel.trim()) { message.error('请填写中文显示名'); return; }
    const validFields = fieldRows.filter(r => r.name.trim() && r.label.trim());
    if (validFields.length === 0) { message.error('至少需要一个完整的字段'); return; }

    setSubmitting(true);
    try {
      const fields: FieldSchema[] = validFields.map(r => ({
        id: r.name.trim(), name: r.name.trim(), label: r.label.trim(), type: r.type,
        ...(r.type === 'ref' ? { refType: r.refType } : {}),
        ...(r.type === 'enum' && r.enumValues?.length ? { enumValues: r.enumValues } : {}),
        ...(r.type === 'enum' ? { optionsKey: r.optionsKey || r.name.trim() } : {}),
        concept: r.concept, anchor: r.anchor,
      }));
      await api.createSchema({ nodeType: nodeType.trim(), label: tableLabel.trim(), fields });
      message.success(`表 "${nodeType}" 创建成功`);
      setNodeType(''); setTableLabel('');
      setFieldRows([{ key: String(Date.now()), name: '', label: '', type: 'string' }]);
      await loadSchemas();
    } catch (e: any) { message.error(e.message); }
    finally { setSubmitting(false); }
  };

  const handleDeleteSchema = async (nt: string) => {
    try {
      await api.deleteSchema(nt);
      message.success('已删除');
      if (selectedSchema?.nodeType === nt) setSelectedSchema(null);
      await loadSchemas();
    } catch (e: any) { message.error(e.message); }
  };

  const handleSetOptionsKey = async (nodeType: string, fieldId: string, optionsKey: string | null) => {
    try {
      const updated = await api.patchSchema(nodeType, { op: 'setOptionsKey', id: fieldId, optionsKey });
      message.success(optionsKey ? `已绑定配置项"${optionsKey}"` : '已解除配置绑定');
      await loadSchemas();
      setSelectedSchema(updated);
    } catch (e: any) { message.error(e.message); }
  };

  const fieldEditorColumns = [
    { title: '字段名', render: (_: unknown, row: FieldRow) => <Input size="small" placeholder="status" value={row.name} onChange={e => updateFieldRow(row.key, { name: e.target.value })} style={{ width: 120 }} /> },
    { title: '标签', render: (_: unknown, row: FieldRow) => <Input size="small" placeholder="状态" value={row.label} onChange={e => updateFieldRow(row.key, { label: e.target.value })} style={{ width: 100 }} /> },
    { title: '类型', render: (_: unknown, row: FieldRow) => <Select size="small" value={row.type} onChange={v => updateFieldRow(row.key, { type: v })} style={{ width: 130 }} options={FIELD_TYPE_OPTIONS} /> },
    { title: '引用目标表', render: (_: unknown, row: FieldRow) => row.type === 'ref' ? <Select size="small" placeholder="选择引用表" value={row.refType} onChange={v => updateFieldRow(row.key, { refType: v })} style={{ width: 120 }} options={schemas.map(s => ({ value: s.nodeType, label: s.label || s.nodeType }))} /> : <Text type="secondary">—</Text> },
    { title: '枚举值', render: (_: unknown, row: FieldRow) => row.type === 'enum' ? <Input size="small" placeholder="待响应,处理中" value={(row.enumValues ?? []).join(',')} onChange={e => updateFieldRow(row.key, { enumValues: e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean) })} style={{ width: 140 }} /> : <Text type="secondary">—</Text> },
    { title: '配置绑定', render: (_: unknown, row: FieldRow) => row.type === 'enum'
      ? <Select size="small" allowClear placeholder="配置中心key" value={row.optionsKey || undefined} onChange={v => updateFieldRow(row.key, { optionsKey: v ?? '' })} style={{ width: 130 }}
          options={[...settingKeys.map(k => ({ value: k, label: k })), { value: row.name, label: `${row.name}（自动）` }]}
          showSearch optionFilterProp="label" />
      : <Text type="secondary">—</Text> },
    { title: '概念', render: (_: unknown, row: FieldRow) => row.concept ? <Tag color="purple">{row.concept}</Tag> : <Text type="secondary">—</Text> },
    { title: '', render: (_: unknown, row: FieldRow) => <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => removeFieldRow(row.key)} disabled={fieldRows.length <= 1} /> },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>表结构管理</Title>
        <HelpButton title={HELP.schemaWizard.title} content={HELP.schemaWizard.content} />
      </div>
      <Row gutter={24}>
        <Col xs={24} lg={10}>
          <Card title="现有数据表" size="small" loading={loadingSchemas} style={{ marginBottom: 16 }}>
            <Table size="small" dataSource={schemas} rowKey="nodeType" pagination={false}
              columns={[
                { title: '类型标识', dataIndex: 'nodeType', render: (v: string) => <Text code>{v}</Text> },
                { title: '显示名', dataIndex: 'label' },
                { title: '字段数', render: (_: unknown, r: NodeSchema) => r.fields.length },
                { title: '', width: 60, render: (_: unknown, r: NodeSchema) => (
                  <Popconfirm title="确认删除？有数据的表无法删除" onConfirm={() => handleDeleteSchema(r.nodeType)}>
                    <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                )},
              ]}
              onRow={(record) => ({
                onClick: () => setSelectedSchema(selectedSchema?.nodeType === record.nodeType ? null : record),
                style: { cursor: 'pointer', background: selectedSchema?.nodeType === record.nodeType ? '#e6f4ff' : undefined },
              })}
            />
          </Card>
          {selectedSchema && (
            <Card title={<Space><Text strong>{selectedSchema.label}</Text><Text code>{selectedSchema.nodeType}</Text></Space>} size="small"
              extra={<Button size="small" type="text" onClick={() => setSelectedSchema(null)}>关闭</Button>}>
              <Table size="small" dataSource={selectedSchema.fields} rowKey="id" pagination={false}
                columns={[
                  { title: '字段ID', dataIndex: 'id', render: (v: string) => <Text code>{v}</Text> },
                  { title: '标签', dataIndex: 'label' },
                  { title: '类型', dataIndex: 'type', render: (v: string) => <Tag>{v}</Tag> },
                  { title: '概念', dataIndex: 'concept', render: (v?: string) => v ? <Tag color="purple">{v}</Tag> : '—' },
                  { title: '配置绑定', width: 160, render: (_: unknown, f: FieldSchema) => f.type === 'enum'
                    ? <Select size="small" allowClear placeholder="选择配置项" value={f.optionsKey || undefined}
                        onChange={v => handleSetOptionsKey(selectedSchema.nodeType, f.id, v ?? null)}
                        style={{ width: 140 }}
                        options={[...settingKeys.map(k => ({ value: k, label: k })), { value: f.name, label: `${f.name}（自动）` }]}
                        showSearch optionFilterProp="label" />
                    : <Text type="secondary">—</Text> },
                ]} />
            </Card>
          )}
        </Col>
        <Col xs={24} lg={14}>
          <Card title="新建数据表" size="small">
            <div style={{ marginBottom: 16 }}>
              <Row gutter={16}>
                <Col span={12}>
                  <div style={{ marginBottom: 8 }}><Text type="secondary">表名 (英文 camelCase)</Text></div>
                  <Input placeholder="e.g. workOrder" value={nodeType} onChange={e => setNodeType(e.target.value)} />
                </Col>
                <Col span={12}>
                  <div style={{ marginBottom: 8 }}><Text type="secondary">中文显示名</Text></div>
                  <Input placeholder="e.g. 工单" value={tableLabel} onChange={e => setTableLabel(e.target.value)} />
                </Col>
              </Row>
            </div>
            <Divider orientation="left" style={{ margin: '8px 0' }}>字段定义</Divider>
            <Table size="small" dataSource={fieldRows} rowKey="key" columns={fieldEditorColumns} pagination={false} style={{ marginBottom: 8 }} />
            <Space style={{ marginTop: 8 }}>
              <Button icon={<PlusOutlined />} onClick={addFieldRow} size="small">添加字段</Button>
              <Button type="primary" onClick={handleSubmit} loading={submitting}>创建数据表</Button>
            </Space>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
