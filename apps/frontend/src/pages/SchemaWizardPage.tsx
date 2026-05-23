import React, { useEffect, useState, useCallback } from "react";
import {
  Table,
  Form,
  Input,
  Select,
  Button,
  Popover,
  List,
  Tag,
  message,
  Card,
  Space,
  Typography,
  Row,
  Col,
  Divider,
} from "antd";
import {
  PlusOutlined,
  DeleteOutlined,
  SearchOutlined,
  CheckOutlined,
} from "@ant-design/icons";
import type { FieldType } from "@combat/shared";

const { Title, Text } = Typography;

// ---- Types ----

interface FieldSchema {
  id?: string;
  name: string;
  type: FieldType;
  label: string;
  required?: boolean;
  enumValues?: string[];
  concept?: string;
  anchor?: string;
}

interface NodeSchema {
  nodeType: string;
  label: string;
  fields: FieldSchema[];
  identityKeys: string[];
  derivedToKG: boolean;
}

interface SchemaSuggestion {
  nodeType: string;
  fieldId: string;
  fieldName: string;
  label: string;
  type: FieldType;
  concept?: string;
  anchor?: string;
  matchReason: string;
}

// ---- Row type for the field editor ----

interface FieldRow {
  key: string;
  name: string;
  label: string;
  type: FieldType;
  refType?: string;  // for type="ref" — target nodeType (no data duplication)
  enumValues?: string[];  // for type="enum" — allowed values
  concept?: string;
  anchor?: string;
}

// ---- API helpers ----

async function fetchSchemas(): Promise<NodeSchema[]> {
  const r = await fetch("/api/schema/list");
  if (!r.ok) throw new Error("获取 Schema 列表失败");
  return r.json();
}

async function fetchSuggestions(q: string): Promise<SchemaSuggestion[]> {
  if (!q.trim()) return [];
  const r = await fetch(`/api/schema/suggest?q=${encodeURIComponent(q)}`);
  if (!r.ok) throw new Error("查找字段失败");
  return r.json();
}

async function createSchema(body: {
  nodeType: string;
  label: string;
  fields: FieldSchema[];
  identityKeys?: string[];
}): Promise<NodeSchema> {
  const r = await fetch("/api/schema/nodeType", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? "创建 Schema 失败");
  return data;
}

// ---- Field type options ----

const FIELD_TYPE_OPTIONS: { value: FieldType; label: string }[] = [
  { value: "string", label: "文本 (string)" },
  { value: "number", label: "数字 (number)" },
  { value: "date", label: "日期 (date)" },
  { value: "datetime", label: "日期时间 (datetime)" },
  { value: "enum", label: "枚举 (enum)" },
  { value: "ref", label: "引用 ref（零重复，关联已有记录）" },
  { value: "sequence", label: "序号 (sequence)" },
];

// ---- Suggestion popover for a single field row ----

interface SuggestPopoverProps {
  fieldName: string;
  onReuse: (s: SchemaSuggestion) => void;
}

function SuggestPopover({ fieldName, onReuse }: SuggestPopoverProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<SchemaSuggestion[]>([]);

  const handleOpen = useCallback(
    async (visible: boolean) => {
      setOpen(visible);
      if (visible && fieldName.trim()) {
        setLoading(true);
        try {
          const results = await fetchSuggestions(fieldName);
          setSuggestions(results);
        } catch {
          setSuggestions([]);
        } finally {
          setLoading(false);
        }
      }
    },
    [fieldName],
  );

  const content = (
    <div style={{ maxWidth: 400, maxHeight: 300, overflowY: "auto" }}>
      {loading ? (
        <Text type="secondary">搜索中…</Text>
      ) : suggestions.length === 0 ? (
        <Text type="secondary">无匹配字段</Text>
      ) : (
        <List
          size="small"
          dataSource={suggestions}
          renderItem={(s) => (
            <List.Item
              actions={[
                <Button
                  key="reuse"
                  size="small"
                  icon={<CheckOutlined />}
                  onClick={() => {
                    onReuse(s);
                    setOpen(false);
                  }}
                >
                  复用此概念
                </Button>,
              ]}
            >
              <List.Item.Meta
                title={
                  <Space size={4}>
                    <Text strong>{s.label}</Text>
                    <Tag color="blue">{s.nodeType}</Tag>
                    <Tag color="green">{s.matchReason}</Tag>
                  </Space>
                }
                description={
                  <Space size={4} wrap>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      类型: {s.type}
                    </Text>
                    {s.concept && (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        概念: {s.concept}
                      </Text>
                    )}
                    {s.anchor && (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        锚: {s.anchor}
                      </Text>
                    )}
                  </Space>
                }
              />
            </List.Item>
          )}
        />
      )}
    </div>
  );

  return (
    <Popover
      content={content}
      title={`"${fieldName}" 的现有字段匹配`}
      trigger="click"
      open={open}
      onOpenChange={handleOpen}
    >
      <Button size="small" icon={<SearchOutlined />}>
        查找现有字段
      </Button>
    </Popover>
  );
}

// ---- Main Page ----

export function SchemaWizardPage() {
  const [schemas, setSchemas] = useState<NodeSchema[]>([]);
  const [selectedSchema, setSelectedSchema] = useState<NodeSchema | null>(null);
  const [loadingSchemas, setLoadingSchemas] = useState(false);

  // Create form state
  const [nodeType, setNodeType] = useState("");
  const [tableLabel, setTableLabel] = useState("");
  const [fieldRows, setFieldRows] = useState<FieldRow[]>([
    { key: "0", name: "", label: "", type: "string" },
  ]);
  const [submitting, setSubmitting] = useState(false);

  const loadSchemas = useCallback(async () => {
    setLoadingSchemas(true);
    try {
      const data = await fetchSchemas();
      setSchemas(data);
    } catch (e: unknown) {
      message.error((e as Error).message ?? "加载 Schema 失败");
    } finally {
      setLoadingSchemas(false);
    }
  }, []);

  useEffect(() => {
    loadSchemas();
  }, [loadSchemas]);

  // Field row operations
  const addFieldRow = () => {
    setFieldRows((prev) => [
      ...prev,
      { key: String(Date.now()), name: "", label: "", type: "string" },
    ]);
  };

  const removeFieldRow = (key: string) => {
    setFieldRows((prev) => prev.filter((r) => r.key !== key));
  };

  const updateFieldRow = (key: string, patch: Partial<FieldRow>) => {
    setFieldRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    );
  };

  const handleReuseConceptFor = (key: string, s: SchemaSuggestion) => {
    updateFieldRow(key, {
      name: s.fieldId,
      type: s.type,
      concept: s.concept,
      anchor: s.anchor,
      label: s.label,
    });
    message.success(`已复用 "${s.label}" 的概念/锚点`);
  };

  // Submit
  const handleSubmit = async () => {
    if (!nodeType.trim()) {
      message.error("请填写表名 (nodeType)");
      return;
    }
    if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(nodeType)) {
      message.error("表名必须以字母开头，只包含字母和数字（camelCase）");
      return;
    }
    if (!tableLabel.trim()) {
      message.error("请填写中文显示名");
      return;
    }
    const validFields = fieldRows.filter((r) => r.name.trim() && r.label.trim());
    if (validFields.length === 0) {
      message.error("至少需要一个完整的字段（含字段名和标签）");
      return;
    }
    for (const r of validFields) {
      if (r.type === "enum" && (!r.enumValues || r.enumValues.length === 0)) {
        message.error(`字段 "${r.label || r.name}" 类型为 enum，请填写枚举值`);
        return;
      }
      if (r.type === "ref" && !r.refType) {
        message.error(`字段 "${r.label || r.name}" 类型为 ref，请选择引用的目标表`);
        return;
      }
    }

    setSubmitting(true);
    try {
      const fields: FieldSchema[] = validFields.map((r) => ({
        id: r.name.trim(),
        name: r.name.trim(),
        label: r.label.trim(),
        type: r.type,
        ...(r.type === "ref" ? { refType: r.refType } : {}),
        ...(r.type === "enum" && r.enumValues?.length ? { enumValues: r.enumValues } : {}),
        concept: r.concept,
        anchor: r.anchor,
      }));
      await createSchema({ nodeType: nodeType.trim(), label: tableLabel.trim(), fields });
      message.success(`表 "${nodeType}" 创建成功`);
      // Reset form
      setNodeType("");
      setTableLabel("");
      setFieldRows([{ key: String(Date.now()), name: "", label: "", type: "string" }]);
      // Refresh list
      await loadSchemas();
    } catch (e: unknown) {
      message.error((e as Error).message ?? "创建失败");
    } finally {
      setSubmitting(false);
    }
  };

  // ---- Schema list columns ----

  const schemaListColumns = [
    {
      title: "类型标识",
      dataIndex: "nodeType",
      key: "nodeType",
      render: (v: string) => <Text code>{v}</Text>,
    },
    {
      title: "显示名",
      dataIndex: "label",
      key: "label",
    },
    {
      title: "字段数",
      key: "fieldCount",
      render: (_: unknown, r: NodeSchema) => r.fields.length,
    },
  ];

  // ---- Field detail columns (for selected schema) ----

  const fieldDetailColumns = [
    { title: "字段ID", dataIndex: "id", key: "id", render: (v: string) => <Text code>{v}</Text> },
    { title: "名称", dataIndex: "name", key: "name" },
    { title: "标签", dataIndex: "label", key: "label" },
    { title: "类型", dataIndex: "type", key: "type", render: (v: string) => <Tag>{v}</Tag> },
    {
      title: "概念",
      dataIndex: "concept",
      key: "concept",
      render: (v?: string) => v ? <Tag color="purple">{v}</Tag> : <Text type="secondary">—</Text>,
    },
  ];

  // ---- Field editor columns ----

  const fieldEditorColumns = [
    {
      title: "字段名 (英文)",
      key: "name",
      render: (_: unknown, row: FieldRow) => (
        <Input
          size="small"
          placeholder="e.g. status"
          value={row.name}
          onChange={(e) => updateFieldRow(row.key, { name: e.target.value })}
          style={{ width: 140 }}
        />
      ),
    },
    {
      title: "标签 (中文)",
      key: "label",
      render: (_: unknown, row: FieldRow) => (
        <Input
          size="small"
          placeholder="e.g. 状态"
          value={row.label}
          onChange={(e) => updateFieldRow(row.key, { label: e.target.value })}
          style={{ width: 120 }}
        />
      ),
    },
    {
      title: "类型",
      key: "type",
      render: (_: unknown, row: FieldRow) => (
        <Select
          size="small"
          value={row.type}
          onChange={(v) => updateFieldRow(row.key, { type: v })}
          style={{ width: 160 }}
          options={FIELD_TYPE_OPTIONS}
        />
      ),
    },
    {
      title: "引用目标表",
      key: "refType",
      render: (_: unknown, row: FieldRow) =>
        row.type === "ref" ? (
          <Select
            size="small"
            placeholder="选择引用表"
            value={row.refType}
            onChange={(v) => updateFieldRow(row.key, { refType: v })}
            style={{ width: 140 }}
            options={schemas.map(s => ({ value: s.nodeType, label: s.label || s.nodeType }))}
          />
        ) : <Text type="secondary" style={{ fontSize: 11 }}>—</Text>,
    },
    {
      title: "枚举值",
      key: "enumValues",
      render: (_: unknown, row: FieldRow) =>
        row.type === "enum" ? (
          <Input
            size="small"
            placeholder="待响应,处理中,已解决"
            value={(row.enumValues ?? []).join(",")}
            onChange={(e) => updateFieldRow(row.key, {
              enumValues: e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean)
            })}
            style={{ width: 160 }}
          />
        ) : <Text type="secondary" style={{ fontSize: 11 }}>—</Text>,
    },
    {
      title: "查找现有字段",
      key: "suggest",
      render: (_: unknown, row: FieldRow) => (
        <SuggestPopover
          fieldName={row.name || row.label}
          onReuse={(s) => handleReuseConceptFor(row.key, s)}
        />
      ),
    },
    {
      title: "概念",
      key: "concept",
      render: (_: unknown, row: FieldRow) =>
        row.concept ? <Tag color="purple">{row.concept}</Tag> : <Text type="secondary">—</Text>,
    },
    {
      title: "",
      key: "remove",
      render: (_: unknown, row: FieldRow) => (
        <Button
          size="small"
          type="text"
          danger
          icon={<DeleteOutlined />}
          onClick={() => removeFieldRow(row.key)}
          disabled={fieldRows.length <= 1}
        />
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Title level={3}>动态新增表 — Schema 管理</Title>
      <Row gutter={24}>
        {/* Left: Schema list */}
        <Col xs={24} lg={10}>
          <Card
            title="现有数据表"
            size="small"
            style={{ marginBottom: 16 }}
            loading={loadingSchemas}
          >
            <Table
              size="small"
              dataSource={schemas}
              rowKey="nodeType"
              columns={schemaListColumns}
              pagination={false}
              onRow={(record) => ({
                onClick: () =>
                  setSelectedSchema(
                    selectedSchema?.nodeType === record.nodeType ? null : record,
                  ),
                style: {
                  cursor: "pointer",
                  background:
                    selectedSchema?.nodeType === record.nodeType
                      ? "#e6f4ff"
                      : undefined,
                },
              })}
            />
          </Card>

          {selectedSchema && (
            <Card
              title={
                <Space>
                  <Text strong>{selectedSchema.label}</Text>
                  <Text code>{selectedSchema.nodeType}</Text>
                  <Text type="secondary">— 字段详情</Text>
                </Space>
              }
              size="small"
              extra={
                <Button size="small" type="text" onClick={() => setSelectedSchema(null)}>
                  关闭
                </Button>
              }
            >
              <Table
                size="small"
                dataSource={selectedSchema.fields}
                rowKey="id"
                columns={fieldDetailColumns}
                pagination={false}
              />
            </Card>
          )}
        </Col>

        {/* Right: Create form */}
        <Col xs={24} lg={14}>
          <Card title="新建数据表" size="small"
            extra={<Text type="secondary" style={{ fontSize: 12 }}>ref 字段直接链接已有记录，数据只存一份</Text>}>
            <Form layout="vertical" style={{ marginBottom: 0 }}>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item
                    label="表名 (nodeType, 英文 camelCase)"
                    required
                  >
                    <Input
                      placeholder="e.g. workOrder"
                      value={nodeType}
                      onChange={(e) => setNodeType(e.target.value)}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="中文显示名 (label)" required>
                    <Input
                      placeholder="e.g. 工单"
                      value={tableLabel}
                      onChange={(e) => setTableLabel(e.target.value)}
                    />
                  </Form.Item>
                </Col>
              </Row>
            </Form>

            <Divider orientation="left" style={{ margin: "8px 0" }}>
              字段定义
            </Divider>

            <Table
              size="small"
              dataSource={fieldRows}
              rowKey="key"
              columns={fieldEditorColumns}
              pagination={false}
              style={{ marginBottom: 8 }}
            />

            <Space style={{ marginTop: 8 }}>
              <Button
                icon={<PlusOutlined />}
                onClick={addFieldRow}
                size="small"
              >
                添加字段
              </Button>
              <Button
                type="primary"
                onClick={handleSubmit}
                loading={submitting}
              >
                创建数据表
              </Button>
            </Space>
          </Card>
        </Col>
      </Row>
    </div>
  );
}

export default SchemaWizardPage;
