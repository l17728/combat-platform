import { useState } from "react";
import {
  Button,
  Space,
  Popover,
  Checkbox,
  Descriptions,
  Typography,
  Card,
  Modal,
  Form,
  Input,
  Select,
  message,
} from "antd";
import { AppstoreOutlined, PlusOutlined } from "@ant-design/icons";
import type { FieldSchema, GraphNode } from "@combat/shared";
import { SchemaFieldView, groupAndSortFields, evalVisible } from "../../components/SchemaField.js";
import { api } from "../../api.js";

const { Text } = Typography;

export interface AttackBasicInfoTabProps {
  node: GraphNode;
  basicFields: FieldSchema[];
  hiddenBasicFields: string[];
  onHiddenChange: (hidden: string[]) => void;
  onSchemaRefresh?: () => void;
  allFieldNames?: string[];
}

const FIELD_TYPES = [
  { value: "text", label: "文本" },
  { value: "textarea", label: "长文本" },
  { value: "number", label: "数字" },
  { value: "date", label: "日期" },
  { value: "enum", label: "枚举" },
  { value: "boolean", label: "布尔" },
];

export default function AttackBasicInfoTab({
  node,
  basicFields,
  hiddenBasicFields,
  onHiddenChange,
  onSchemaRefresh,
  allFieldNames,
}: AttackBasicInfoTabProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addForm] = Form.useForm();
  const [enumSource, setEnumSource] = useState<"manual" | "config">("manual");
  const props = node.properties;
  const renderable = basicFields.filter(
    (f) => !f.retired && !hiddenBasicFields.includes(f.name) && evalVisible(f.visible, props)
  );
  const groups = groupAndSortFields(renderable);
  const existingGroups = [...new Set(basicFields.map((f) => f.group).filter(Boolean))];

  const handleAddField = async () => {
    const values = { ...addForm.getFieldsValue() };
    const name = values.name?.trim();
    if (!name) {
      addForm.validateFields(["name"]).catch(() => {});
      return;
    }
    if (allFieldNames?.includes(name)) {
      message.warning("该字段已存在，可在字段管理中恢复显示");
      return;
    }
    try {
      setAddSubmitting(true);
      const field: Record<string, any> = {
        name,
        label: values.label || name,
        type: values.type || "text",
        group: values.group || "其它字段",
      };
      if (values.type === "enum") {
        if (enumSource === "config" && values.optionsKey) {
          field.optionsKey = values.optionsKey;
        } else if (values.enumValues) {
          field.enumValues = values.enumValues
            .split(/[,，]/)
            .map((s: string) => s.trim())
            .filter(Boolean);
        }
      }
      await api.addSchemaField("attackTicket", field);
      message.success(`字段「${field.label}」已添加`);
      setAddOpen(false);
      addForm.resetFields();
      onSchemaRefresh?.();
    } catch (e) {
      message.error("添加失败: " + ((e as Error).message || "未知错误"));
    } finally {
      setAddSubmitting(false);
    }
  };

  return (
    <div style={{ padding: "16px 0" }}>
      <Space style={{ marginBottom: 12 }}>
        <Popover
          trigger="click"
          placement="bottomLeft"
          content={
            <div style={{ minWidth: 220, maxHeight: 320, overflow: "auto" }}>
              <Checkbox.Group
                value={basicFields.map((f) => f.name).filter((n) => !hiddenBasicFields.includes(n))}
                onChange={(vals) => {
                  const visible = vals as string[];
                  onHiddenChange(basicFields.map((f) => f.name).filter((n) => !visible.includes(n)));
                }}
                style={{ display: "flex", flexDirection: "column", gap: 6 }}
              >
                {basicFields.map((f) => (
                  <Checkbox key={f.name} value={f.name}>
                    {f.label}
                    {f.group ? (
                      <Text type="secondary" style={{ marginLeft: 6, fontSize: 11 }}>
                        · {f.group}
                      </Text>
                    ) : null}
                  </Checkbox>
                ))}
              </Checkbox.Group>
              {hiddenBasicFields.length > 0 && (
                <Button
                  type="link"
                  size="small"
                  onClick={() => onHiddenChange([])}
                  style={{ paddingLeft: 0, marginTop: 8 }}
                >
                  全部恢复
                </Button>
              )}
              <div style={{ borderTop: "1px solid #f0f0f0", marginTop: 8, paddingTop: 8 }}>
                <Button
                  type="link"
                  icon={<PlusOutlined />}
                  size="small"
                  onClick={() => setAddOpen(true)}
                  style={{ paddingLeft: 0 }}
                >
                  添加新字段
                </Button>
              </div>
            </div>
          }
        >
          <Button icon={<AppstoreOutlined />} size="small">
            字段管理{hiddenBasicFields.length > 0 ? `(已隐藏 ${hiddenBasicFields.length})` : ""}
          </Button>
        </Popover>
        <Button icon={<PlusOutlined />} size="small" type="dashed" onClick={() => setAddOpen(true)}>
          添加字段
        </Button>
      </Space>
      {groups.length === 0 ? (
        <Text type="secondary">没有可显示的字段</Text>
      ) : (
        groups.map(({ group, fields }) => (
          <Card key={group} size="small" title={group} style={{ marginBottom: 16 }}>
            <Descriptions bordered column={2} size="small">
              {fields.map((f) => (
                <Descriptions.Item key={f.name} label={f.label}>
                  <SchemaFieldView field={f} value={props[f.name]} />
                </Descriptions.Item>
              ))}
            </Descriptions>
          </Card>
        ))
      )}

      <Modal
        title="添加新字段"
        open={addOpen}
        onCancel={() => {
          setAddOpen(false);
          addForm.resetFields();
        }}
        onOk={handleAddField}
        confirmLoading={addSubmitting}
        destroyOnClose
        width={460}
      >
        <Form form={addForm} layout="vertical" initialValues={{ type: "text", group: "其它字段" }}>
          <Form.Item name="name" label="字段名（英文，作为存储键）" rules={[{ required: true, message: "必填" }]}>
            <Input placeholder="如：priority_level" />
          </Form.Item>
          <Form.Item name="label" label="显示名称">
            <Input placeholder="留空则使用字段名" />
          </Form.Item>
          <Form.Item name="type" label="字段类型">
            <Select options={FIELD_TYPES} />
          </Form.Item>
          <Form.Item name="group" label="所属分组">
            <Select
              allowClear
              placeholder="选择或输入分组名"
              options={existingGroups.map((g) => ({ value: g, label: g }))}
              dropdownRender={(menu) => <>{menu}</>}
            />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.type !== cur.type}>
            {({ getFieldValue }) =>
              getFieldValue("type") === "enum" ? (
                <>
                  <Form.Item label="枚举值来源">
                    <Select
                      value={enumSource}
                      onChange={setEnumSource}
                      options={[
                        { value: "manual", label: "手动输入" },
                        { value: "config", label: "配置中心" },
                      ]}
                    />
                  </Form.Item>
                  {enumSource === "manual" ? (
                    <Form.Item name="enumValues" label="枚举值（逗号分隔）">
                      <Input placeholder="高,中,低" />
                    </Form.Item>
                  ) : (
                    <Form.Item name="optionsKey" label="配置中心键名">
                      <Input placeholder="如：Bug 严重程度" />
                    </Form.Item>
                  )}
                </>
              ) : null
            }
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
