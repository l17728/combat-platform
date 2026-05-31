import { Button, Space, Popover, Checkbox, Descriptions, Typography, Card } from "antd";
import { AppstoreOutlined } from "@ant-design/icons";
import type { FieldSchema, GraphNode } from "@combat/shared";
import { SchemaFieldView, groupAndSortFields, evalVisible } from "../../components/SchemaField.js";

const { Text } = Typography;

export interface AttackBasicInfoTabProps {
  node: GraphNode;
  basicFields: FieldSchema[];
  hiddenBasicFields: string[];
  onHiddenChange: (hidden: string[]) => void;
}

// v2.6: 详情页基础信息 Tab — schema 驱动的分组渲染。
// - basicFields 仍由父组件传(已剔除 retired);
// - 渲染按 FieldSchema.group + FieldSchema.order 分组,每组一张 Card + Descriptions;
// - 隐藏偏好(字段管理 Popover)按 field.name 持久化,跨分组生效。
export default function AttackBasicInfoTab({
  node,
  basicFields,
  hiddenBasicFields,
  onHiddenChange,
}: AttackBasicInfoTabProps) {
  const props = node.properties;
  // 过滤:retired/隐藏偏好/visible 表达式
  const renderable = basicFields.filter(
    (f) => !f.retired && !hiddenBasicFields.includes(f.name) && evalVisible(f.visible, props)
  );
  const groups = groupAndSortFields(renderable);
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
            </div>
          }
        >
          <Button icon={<AppstoreOutlined />} size="small">
            字段管理{hiddenBasicFields.length > 0 ? `(已隐藏 ${hiddenBasicFields.length})` : ""}
          </Button>
        </Popover>
        <Text type="secondary" style={{ fontSize: 12 }}>
          字段及分组在 表结构管理 维护;隐藏偏好按用户保存。
        </Text>
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
    </div>
  );
}
