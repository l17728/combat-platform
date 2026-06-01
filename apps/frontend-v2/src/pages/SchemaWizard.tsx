import { useEffect, useState, useCallback } from "react";
import {
  Table,
  Input,
  Select,
  Button,
  List,
  Tag,
  message,
  Card,
  Space,
  Typography,
  Row,
  Col,
  Divider,
  Popconfirm,
  Popover,
  Tooltip,
} from "antd";
import {
  PlusOutlined,
  DeleteOutlined,
  SearchOutlined,
  CheckOutlined,
  LinkOutlined,
  DisconnectOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
} from "@ant-design/icons";
import type { FieldSchema, FieldType, NodeSchema } from "@combat/shared";
import { api } from "../api.js";
import type { SchemaSuggestion } from "../api.js";
import { useSettings } from "../hooks/useSettings.js";
import HelpButton from "../components/HelpButton.js";
import HELP from "../help-content.js";
import { handleApiError } from "../utils/handleApiError.js";

const { Title, Text } = Typography;

const FIELD_TYPE_OPTIONS: { value: FieldType; label: string }[] = [
  { value: "string", label: "文本 (string)" },
  { value: "number", label: "数字 (number)" },
  { value: "date", label: "日期 (date)" },
  { value: "datetime", label: "日期时间 (datetime)" },
  { value: "enum", label: "枚举 (enum)" },
  { value: "ref", label: "引用 ref" },
  { value: "sequence", label: "序号 (sequence)" },
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

  const handleOpen = useCallback(
    async (visible: boolean) => {
      setOpen(visible);
      if (visible && fieldName.trim()) {
        setLoading(true);
        try {
          setSuggestions(await api.suggestSchema(fieldName));
        } catch {
          setSuggestions([]);
        } finally {
          setLoading(false);
        }
      }
    },
    [fieldName]
  );

  return (
    <Popover
      content={
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
                      复用
                    </Button>,
                  ]}
                >
                  <List.Item.Meta
                    title={
                      <Space size={4}>
                        <Text strong>{s.label}</Text>
                        <Tag color="blue">{s.nodeType}</Tag>
                      </Space>
                    }
                    description={
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        类型: {s.type}
                        {s.concept ? ` 概念: ${s.concept}` : ""}
                        {s.anchor ? ` 锚: ${s.anchor}` : ""}
                      </Text>
                    }
                  />
                </List.Item>
              )}
            />
          )}
        </div>
      }
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

export default function SchemaWizard() {
  const [schemas, setSchemas] = useState<NodeSchema[]>([]);
  const [selectedSchema, setSelectedSchema] = useState<NodeSchema | null>(null);
  const [loadingSchemas, setLoadingSchemas] = useState(false);
  const [nodeType, setNodeType] = useState("");
  const [tableLabel, setTableLabel] = useState("");
  const [fieldRows, setFieldRows] = useState<FieldRow[]>([{ key: "0", name: "", label: "", type: "string" }]);
  const [submitting, setSubmitting] = useState(false);
  const [newFieldDraft, setNewFieldDraft] = useState<{
    name: string;
    label: string;
    type: FieldType;
    enumValues: string;
    group: string;
  }>({ name: "", label: "", type: "string", enumValues: "", group: "" });
  const [addingField, setAddingField] = useState(false);
  // v2.3.4: 新分组占位输入框
  const [newGroupName, setNewGroupName] = useState("");
  const { settings } = useSettings();
  const settingKeys = Object.keys(settings).filter((k) => !k.includes("."));

  const loadSchemas = useCallback(async () => {
    setLoadingSchemas(true);
    try {
      setSchemas(await api.listSchemas());
    } catch {
      setSchemas([]);
    } finally {
      setLoadingSchemas(false);
    }
  }, []);

  useEffect(() => {
    loadSchemas();
  }, [loadSchemas]);

  const addFieldRow = () =>
    setFieldRows((prev) => [...prev, { key: String(Date.now()), name: "", label: "", type: "string" }]);
  const removeFieldRow = (key: string) => setFieldRows((prev) => prev.filter((r) => r.key !== key));
  const updateFieldRow = (key: string, patch: Partial<FieldRow>) =>
    setFieldRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const handleReuseConceptFor = (key: string, s: SchemaSuggestion) => {
    updateFieldRow(key, {
      name: s.fieldName,
      type: s.type as FieldType,
      concept: s.concept,
      anchor: s.anchor,
      label: s.label,
    });
    message.success(`已复用 "${s.label}" 的概念/锚点`);
  };

  const handleSubmit = async () => {
    if (!nodeType.trim() || !/^[a-zA-Z][a-zA-Z0-9]*$/.test(nodeType)) {
      message.error("表名必须以字母开头，只包含字母和数字");
      return;
    }
    if (!tableLabel.trim()) {
      message.error("请填写中文显示名");
      return;
    }
    const validFields = fieldRows.filter((r) => r.name.trim() && r.label.trim());
    if (validFields.length === 0) {
      message.error("至少需要一个完整的字段");
      return;
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
        ...(r.type === "enum" ? { optionsKey: r.optionsKey || r.name.trim() } : {}),
        concept: r.concept,
        anchor: r.anchor,
      }));
      await api.createSchema({ nodeType: nodeType.trim(), label: tableLabel.trim(), fields });
      message.success(`表 "${nodeType}" 创建成功`);
      setNodeType("");
      setTableLabel("");
      setFieldRows([{ key: String(Date.now()), name: "", label: "", type: "string" }]);
      await loadSchemas();
    } catch (e) {
      handleApiError(e);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteSchema = async (nt: string) => {
    try {
      await api.deleteSchema(nt);
      message.success("已删除");
      if (selectedSchema?.nodeType === nt) setSelectedSchema(null);
      await loadSchemas();
    } catch (e) {
      handleApiError(e);
    }
  };

  const handleAddFieldToSchema = async () => {
    if (!selectedSchema) return;
    const name = newFieldDraft.name.trim();
    const label = newFieldDraft.label.trim() || name;
    if (!name) {
      message.warning("请输入字段名");
      return;
    }
    if (selectedSchema.fields.some((f) => f.name === name)) {
      message.error(`字段名「${name}」已存在`);
      return;
    }
    setAddingField(true);
    try {
      const enumValues =
        newFieldDraft.type === "enum"
          ? newFieldDraft.enumValues
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined;
      const group = newFieldDraft.group.trim();
      const updated = await api.patchSchema(selectedSchema.nodeType, {
        op: "addField",
        field: {
          name,
          label,
          type: newFieldDraft.type,
          ...(enumValues && enumValues.length ? { enumValues } : {}),
          ...(group ? { group } : {}),
        },
      });
      message.success(`字段「${label}」已添加，相关页面将自动显示`);
      setNewFieldDraft({ name: "", label: "", type: "string", enumValues: "", group: "" });
      setSelectedSchema(updated);
      await loadSchemas();
    } catch (e) {
      handleApiError(e);
    } finally {
      setAddingField(false);
    }
  };

  const handleSetOptionsKey = async (nodeType: string, fieldId: string, optionsKey: string | null) => {
    try {
      const updated = await api.patchSchema(nodeType, { op: "setOptionsKey", id: fieldId, optionsKey });
      message.success(optionsKey ? `已绑定配置项"${optionsKey}"` : "已解除配置绑定");
      await loadSchemas();
      setSelectedSchema(updated);
    } catch (e) {
      handleApiError(e);
    }
  };

  const handleRetireField = async (nodeType: string, fieldId: string) => {
    try {
      const updated = await api.patchSchema(nodeType, { op: "retire", id: fieldId });
      message.success("字段已停用");
      await loadSchemas();
      setSelectedSchema(updated);
    } catch (e) {
      handleApiError(e);
    }
  };

  const handleUnretireField = async (nodeType: string, fieldId: string) => {
    try {
      const updated = await api.patchSchema(nodeType, { op: "unretire", id: fieldId });
      message.success("字段已恢复");
      await loadSchemas();
      setSelectedSchema(updated);
    } catch (e) {
      handleApiError(e);
    }
  };

  // v2.3.4: 字段分组管理 ---------------------------------------------------------
  // PATCH /api/schema/<nt> { op: "updateField", ... } 走后端 updateField 分支,
  // 同时写回 baseline / overlay 并记录审计。
  const handleSetFieldGroup = async (nodeType: string, fieldId: string, group: string | null) => {
    try {
      const updated = await api.patchSchema(nodeType, { op: "updateField", id: fieldId, group });
      message.success(group ? `已移入分组「${group}」` : "已移出分组");
      await loadSchemas();
      setSelectedSchema(updated);
    } catch (e) {
      handleApiError(e);
    }
  };

  const handleMoveField = async (nodeType: string, fieldId: string, dir: "up" | "down") => {
    if (!selectedSchema) return;
    // 同组内按 (order asc, idx asc) 排序后,与上/下邻居交换 order。
    const fields = selectedSchema.fields;
    const f = fields.find((x) => x.id === fieldId);
    if (!f) return;
    const group = f.group ?? "其它";
    const sameGroup = fields
      .map((x, idx) => ({ x, idx }))
      .filter((p) => (p.x.group ?? "其它") === group)
      .sort((a, b) => {
        const oa = a.x.order ?? Number.MAX_SAFE_INTEGER;
        const ob = b.x.order ?? Number.MAX_SAFE_INTEGER;
        if (oa !== ob) return oa - ob;
        return a.idx - b.idx;
      });
    const pos = sameGroup.findIndex((p) => p.x.id === fieldId);
    if (pos < 0) return;
    const neighborPos = dir === "up" ? pos - 1 : pos + 1;
    if (neighborPos < 0 || neighborPos >= sameGroup.length) return;
    const neighbor = sameGroup[neighborPos].x;
    const newSelfOrder = sameGroup[neighborPos].x.order ?? neighborPos + 1;
    const newNeighborOrder = sameGroup[pos].x.order ?? pos + 1;
    try {
      await api.patchSchema(selectedSchema.nodeType, {
        op: "updateField",
        id: fieldId,
        order: newSelfOrder,
      });
      const updated = await api.patchSchema(selectedSchema.nodeType, {
        op: "updateField",
        id: neighbor.id,
        order: newNeighborOrder,
      });
      message.success("已调整顺序");
      await loadSchemas();
      setSelectedSchema(updated);
      void nodeType;
    } catch (e) {
      handleApiError(e);
    }
  };

  // 收集当前 schema 的所有分组名(用于「字段分组」侧栏 + 行内 Select)。
  const groupNames = (() => {
    if (!selectedSchema) return [] as string[];
    const set = new Set<string>();
    for (const f of selectedSchema.fields) {
      const g = (f.group && f.group.trim()) || "其它";
      set.add(g);
    }
    return Array.from(set);
  })();

  const handleAddGroup = () => {
    const g = newGroupName.trim();
    if (!g) {
      message.warning("请输入分组名");
      return;
    }
    if (groupNames.includes(g)) {
      message.info("该分组已存在");
      return;
    }
    // 没有"裸创建分组"的后端语义 —— 分组是字段属性派生的。
    // 把第一个未分组(其它)字段移入新组作为占位,没有可移入时仅本地预告。
    if (!selectedSchema) return;
    const firstOrphan = selectedSchema.fields.find((f) => !f.group || !f.group.trim());
    if (firstOrphan) {
      void handleSetFieldGroup(selectedSchema.nodeType, firstOrphan.id, g);
    } else {
      message.info(`分组「${g}」已就绪,先把字段拖入即可生效`);
    }
    setNewGroupName("");
  };

  const fieldEditorColumns = [
    {
      title: "字段名",
      render: (_: unknown, row: FieldRow) => (
        <Input
          size="small"
          placeholder="status"
          value={row.name}
          onChange={(e) => updateFieldRow(row.key, { name: e.target.value })}
          style={{ width: 120 }}
        />
      ),
    },
    {
      title: "标签",
      render: (_: unknown, row: FieldRow) => (
        <Input
          size="small"
          placeholder="状态"
          value={row.label}
          onChange={(e) => updateFieldRow(row.key, { label: e.target.value })}
          style={{ width: 100 }}
        />
      ),
    },
    {
      title: "类型",
      render: (_: unknown, row: FieldRow) => (
        <Select
          size="small"
          value={row.type}
          onChange={(v) => updateFieldRow(row.key, { type: v })}
          style={{ width: 130 }}
          options={FIELD_TYPE_OPTIONS}
        />
      ),
    },
    {
      title: "引用目标表",
      render: (_: unknown, row: FieldRow) =>
        row.type === "ref" ? (
          <Select
            size="small"
            placeholder="选择引用表"
            value={row.refType}
            onChange={(v) => updateFieldRow(row.key, { refType: v })}
            style={{ width: 120 }}
            options={schemas.map((s) => ({ value: s.nodeType, label: s.label || s.nodeType }))}
          />
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: "枚举值",
      render: (_: unknown, row: FieldRow) =>
        row.type === "enum" ? (
          <Input
            size="small"
            placeholder="待响应,处理中"
            value={(row.enumValues ?? []).join(",")}
            onChange={(e) =>
              updateFieldRow(row.key, {
                enumValues: e.target.value
                  .split(",")
                  .map((s: string) => s.trim())
                  .filter(Boolean),
              })
            }
            style={{ width: 140 }}
          />
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: "配置绑定",
      render: (_: unknown, row: FieldRow) =>
        row.type === "enum" ? (
          <Select
            size="small"
            allowClear
            placeholder="配置中心key"
            value={row.optionsKey || undefined}
            onChange={(v) => updateFieldRow(row.key, { optionsKey: v ?? "" })}
            style={{ width: 130 }}
            options={[
              ...settingKeys.map((k) => ({ value: k, label: k })),
              { value: row.name, label: `${row.name}（自动）` },
            ]}
            showSearch
            optionFilterProp="label"
          />
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: "概念",
      render: (_: unknown, row: FieldRow) =>
        row.concept ? <Tag color="purple">{row.concept}</Tag> : <Text type="secondary">—</Text>,
    },
    {
      title: "",
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
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          表结构管理
        </Title>
        <HelpButton title={HELP.schemaWizard.title} content={HELP.schemaWizard.content} />
      </div>
      <Row gutter={24}>
        <Col xs={24} lg={10}>
          <Card title="现有数据表" size="small" loading={loadingSchemas} style={{ marginBottom: 16 }}>
            <Table
              size="small"
              dataSource={schemas}
              rowKey="nodeType"
              pagination={false}
              columns={[
                { title: "类型标识", dataIndex: "nodeType", render: (v: string) => <Text code>{v}</Text> },
                { title: "显示名", dataIndex: "label" },
                { title: "字段数", render: (_: unknown, r: NodeSchema) => r.fields.length },
                {
                  title: "",
                  width: 60,
                  render: (_: unknown, r: NodeSchema) => (
                    <Popconfirm title="确认删除？有数据的表无法删除" onConfirm={() => handleDeleteSchema(r.nodeType)}>
                      <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  ),
                },
              ]}
              onRow={(record) => ({
                onClick: () => setSelectedSchema(selectedSchema?.nodeType === record.nodeType ? null : record),
                style: {
                  cursor: "pointer",
                  background: selectedSchema?.nodeType === record.nodeType ? "#e6f4ff" : undefined,
                },
              })}
            />
          </Card>
        </Col>
        <Col xs={24} lg={14}>
          <Card title="新建数据表" size="small">
            <div style={{ marginBottom: 16 }}>
              <Row gutter={16}>
                <Col span={12}>
                  <div style={{ marginBottom: 8 }}>
                    <Text type="secondary">表名 (英文 camelCase)</Text>
                  </div>
                  <Input placeholder="e.g. workOrder" value={nodeType} onChange={(e) => setNodeType(e.target.value)} />
                </Col>
                <Col span={12}>
                  <div style={{ marginBottom: 8 }}>
                    <Text type="secondary">中文显示名</Text>
                  </div>
                  <Input placeholder="e.g. 工单" value={tableLabel} onChange={(e) => setTableLabel(e.target.value)} />
                </Col>
              </Row>
            </div>
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
              <Button icon={<PlusOutlined />} onClick={addFieldRow} size="small">
                添加字段
              </Button>
              <Button type="primary" onClick={handleSubmit} loading={submitting}>
                创建数据表
              </Button>
            </Space>
          </Card>
        </Col>
      </Row>
      {selectedSchema && (
        <Card
          title={
            <Space>
              <Text strong>{selectedSchema.label}</Text>
              <Text code>{selectedSchema.nodeType}</Text>
              <Text type="secondary">字段详情</Text>
            </Space>
          }
          size="small"
          style={{ marginTop: 16 }}
          extra={
            <Button size="small" type="text" onClick={() => setSelectedSchema(null)}>
              关闭
            </Button>
          }
        >
          {/* v2.3.4: 字段分组管理面板 */}
          <Card
            size="small"
            type="inner"
            title="字段分组"
            style={{ marginBottom: 12 }}
            extra={
              <Space size={4}>
                <Input
                  size="small"
                  placeholder="新分组名"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  onPressEnter={handleAddGroup}
                  style={{ width: 140 }}
                />
                <Button size="small" icon={<PlusOutlined />} onClick={handleAddGroup}>
                  新建分组
                </Button>
              </Space>
            }
          >
            <Space wrap>
              {groupNames.length === 0 ? (
                <Text type="secondary">暂无分组</Text>
              ) : (
                groupNames.map((g) => {
                  const count = selectedSchema.fields.filter(
                    (f) => ((f.group && f.group.trim()) || "其它") === g
                  ).length;
                  return (
                    <Tag key={g} color="blue" style={{ fontSize: 13, padding: "2px 8px" }}>
                      {g}{" "}
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        ({count})
                      </Text>
                    </Tag>
                  );
                })
              )}
            </Space>
            <div style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                每个字段都属于一个分组(默认「其它」)。在下方表格里通过「分组」列下拉切换分组、用 ↑ / ↓
                调整组内顺序。变更会立即生效到详情页。
              </Text>
            </div>
          </Card>

          <Table
            size="small"
            dataSource={selectedSchema.fields}
            rowKey="id"
            pagination={false}
            columns={[
              {
                title: "字段ID",
                dataIndex: "id",
                width: 200,
                render: (v: string, f: FieldSchema) => (
                  <span>
                    <Text code style={{ whiteSpace: "nowrap" }}>
                      {v}
                    </Text>
                    {f.retired && (
                      <Tag color="default" style={{ marginLeft: 4, fontSize: 11 }}>
                        停用
                      </Tag>
                    )}
                  </span>
                ),
              },
              { title: "标签", dataIndex: "label", width: 140 },
              { title: "类型", dataIndex: "type", width: 90, render: (v: string) => <Tag>{v}</Tag> },
              {
                title: "分组",
                width: 160,
                render: (_: unknown, f: FieldSchema) => (
                  <Select
                    size="small"
                    allowClear
                    placeholder="未分组"
                    value={f.group || undefined}
                    onChange={(v) => handleSetFieldGroup(selectedSchema.nodeType, f.id, v ?? null)}
                    style={{ width: 140 }}
                    showSearch
                    options={[
                      ...groupNames.filter((g) => g !== "其它").map((g) => ({ value: g, label: g })),
                      ...(newGroupName.trim() && !groupNames.includes(newGroupName.trim())
                        ? [{ value: newGroupName.trim(), label: `${newGroupName.trim()}(新)` }]
                        : []),
                    ]}
                  />
                ),
              },
              {
                title: "顺序",
                width: 110,
                render: (_: unknown, f: FieldSchema) => (
                  <Space size={2}>
                    <Text
                      type="secondary"
                      style={{ fontSize: 12, width: 24, display: "inline-block", textAlign: "right" }}
                    >
                      {f.order ?? "—"}
                    </Text>
                    <Button
                      size="small"
                      type="text"
                      icon={<ArrowUpOutlined />}
                      onClick={() => handleMoveField(selectedSchema.nodeType, f.id, "up")}
                    />
                    <Button
                      size="small"
                      type="text"
                      icon={<ArrowDownOutlined />}
                      onClick={() => handleMoveField(selectedSchema.nodeType, f.id, "down")}
                    />
                  </Space>
                ),
              },
              {
                title: "概念",
                dataIndex: "concept",
                width: 80,
                render: (v?: string) => (v ? <Tag color="purple">{v}</Tag> : "—"),
              },
              {
                title: "配置绑定",
                width: 200,
                render: (_: unknown, f: FieldSchema) =>
                  f.type === "enum" ? (
                    <Select
                      size="small"
                      allowClear
                      placeholder="选择配置项"
                      value={f.optionsKey || undefined}
                      onChange={(v) => handleSetOptionsKey(selectedSchema.nodeType, f.id, v ?? null)}
                      style={{ width: 180 }}
                      options={[
                        ...settingKeys.map((k) => ({ value: k, label: k })),
                        { value: f.name, label: `${f.name}（自动）` },
                      ]}
                      showSearch
                      optionFilterProp="label"
                    />
                  ) : (
                    <Text type="secondary">—</Text>
                  ),
              },
              {
                title: "",
                width: 80,
                render: (_: unknown, f: FieldSchema) =>
                  f.retired ? (
                    <Button size="small" type="link" onClick={() => handleUnretireField(selectedSchema.nodeType, f.id)}>
                      恢复
                    </Button>
                  ) : (
                    <Popconfirm
                      title={`确认停用字段"${f.label}"？`}
                      description="停用后 UI 将不再显示该字段，已有数据不受影响"
                      onConfirm={() => handleRetireField(selectedSchema.nodeType, f.id)}
                    >
                      <Button size="small" type="link" danger>
                        停用
                      </Button>
                    </Popconfirm>
                  ),
              },
            ]}
          />
          <Divider orientation="left" orientationMargin={0} style={{ marginTop: 16 }}>
            添加新字段
          </Divider>
          <Space wrap align="start">
            <Input
              size="small"
              placeholder="字段名"
              value={newFieldDraft.name}
              onChange={(e) => setNewFieldDraft((s) => ({ ...s, name: e.target.value }))}
              style={{ width: 140 }}
            />
            <Input
              size="small"
              placeholder="显示名(标签)"
              value={newFieldDraft.label}
              onChange={(e) => setNewFieldDraft((s) => ({ ...s, label: e.target.value }))}
              style={{ width: 140 }}
            />
            <Select
              size="small"
              value={newFieldDraft.type}
              onChange={(v) => setNewFieldDraft((s) => ({ ...s, type: v }))}
              style={{ width: 150 }}
              options={FIELD_TYPE_OPTIONS}
            />
            {newFieldDraft.type === "enum" && (
              <Input
                size="small"
                placeholder="枚举值,逗号分隔"
                value={newFieldDraft.enumValues}
                onChange={(e) => setNewFieldDraft((s) => ({ ...s, enumValues: e.target.value }))}
                style={{ width: 180 }}
              />
            )}
            <Select
              size="small"
              allowClear
              placeholder="分组(可选)"
              value={newFieldDraft.group || undefined}
              onChange={(v) => setNewFieldDraft((s) => ({ ...s, group: v ?? "" }))}
              style={{ width: 140 }}
              showSearch
              options={groupNames.filter((g) => g !== "其它").map((g) => ({ value: g, label: g }))}
            />
            <Button
              size="small"
              type="primary"
              icon={<PlusOutlined />}
              loading={addingField}
              onClick={handleAddFieldToSchema}
            >
              新增字段
            </Button>
          </Space>
          <div style={{ marginTop: 8 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              添加后，攻关单等页面的表单会自动显示该字段，无需在其它页面单独新增。
            </Text>
          </div>
        </Card>
      )}
    </div>
  );
}
