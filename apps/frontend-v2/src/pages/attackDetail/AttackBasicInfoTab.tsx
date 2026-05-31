import { Button, Space, Popover, Checkbox, Descriptions, Typography } from "antd";
import { AppstoreOutlined } from "@ant-design/icons";
import type { FieldSchema, GraphNode } from "@combat/shared";

const { Text } = Typography;

export interface AttackBasicInfoTabProps {
  node: GraphNode;
  basicFields: FieldSchema[];
  hiddenBasicFields: string[];
  onHiddenChange: (hidden: string[]) => void;
}

export default function AttackBasicInfoTab({
  node,
  basicFields,
  hiddenBasicFields,
  onHiddenChange,
}: AttackBasicInfoTabProps) {
  const props = node.properties;
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
          勾选要显示的字段;偏好按用户保存,下次进来仍生效。
        </Text>
      </Space>
      <Descriptions bordered column={2} size="small" style={{ marginBottom: 24 }}>
        {basicFields
          .filter((f) => !hiddenBasicFields.includes(f.name))
          .map((f) => (
            <Descriptions.Item key={f.name} label={f.label}>
              {String(props[f.name] ?? "--")}
            </Descriptions.Item>
          ))}
      </Descriptions>
    </div>
  );
}
