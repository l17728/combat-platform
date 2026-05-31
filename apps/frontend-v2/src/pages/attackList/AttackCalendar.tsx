import { useMemo, useState } from "react";
import { Calendar, Tag, Switch, Space, Typography, Popover, Empty } from "antd";
import { useNavigate } from "react-router-dom";
import type { GraphNode } from "@combat/shared";
import dayjs, { Dayjs } from "dayjs";
import StatusTag from "../../components/StatusTag.js";

const { Text } = Typography;

interface Props {
  nodes: GraphNode[];
}

// 事件级别 → 色块色:P0/P1=red, P2=orange, P3+=blue;无值=default
function levelColor(level: string): string {
  const l = (level || "").toUpperCase();
  if (l.includes("P0") || l === "P1") return "#ff4d4f";
  if (l === "P2") return "#fa8c16";
  if (l) return "#1677ff";
  return "#bfbfbf";
}

export default function AttackCalendar({ nodes }: Props) {
  const navigate = useNavigate();
  const [byUpdated, setByUpdated] = useState(false);

  const dateKey = (n: GraphNode) => {
    const s = byUpdated ? n.updatedAt : n.createdAt;
    return dayjs(s).format("YYYY-MM-DD");
  };

  const byDate = useMemo(() => {
    const map: Record<string, GraphNode[]> = {};
    for (const n of nodes) {
      const k = dateKey(n);
      if (!map[k]) map[k] = [];
      map[k].push(n);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, byUpdated]);

  const dateCellRender = (value: Dayjs) => {
    const key = value.format("YYYY-MM-DD");
    const items = byDate[key] || [];
    if (items.length === 0) return null;
    // 同日存在多个攻关单 → 取最严重的事件级别作色块代表
    const sorted = [...items].sort((a, b) => {
      const la = String(a.properties["事件级别"] ?? "").toUpperCase();
      const lb = String(b.properties["事件级别"] ?? "").toUpperCase();
      const w = (l: string) => (l.includes("P0") || l === "P1" ? 0 : l === "P2" ? 1 : l ? 2 : 3);
      return w(la) - w(lb);
    });
    const repColor = levelColor(String(sorted[0].properties["事件级别"] ?? ""));

    const content = (
      <div data-testid={`cal-pop-${key}`} style={{ maxWidth: 320, maxHeight: 320, overflowY: "auto" }}>
        {items.slice(0, 20).map((n) => (
          <div
            key={n.id}
            style={{
              padding: "6px 4px",
              borderBottom: "1px dashed #f0f0f0",
              cursor: "pointer",
            }}
            onClick={() => navigate(`/attack/${n.id}`)}
          >
            <div style={{ fontSize: 12 }}>
              <a>{String(n.properties["标题"] ?? "(未命名)")}</a>
            </div>
            <Space size={4} style={{ marginTop: 2 }}>
              <StatusTag status={String(n.properties["状态"] ?? "")} />
              {n.properties["事件级别"] ? (
                <Tag color="orange" style={{ margin: 0 }}>
                  {String(n.properties["事件级别"])}
                </Tag>
              ) : null}
            </Space>
          </div>
        ))}
        {items.length > 20 && (
          <Text type="secondary" style={{ fontSize: 11 }}>
            还有 {items.length - 20} 条…
          </Text>
        )}
      </div>
    );

    return (
      <Popover content={content} title={`${key} · 共 ${items.length} 条`} trigger="click" destroyTooltipOnHide>
        <div
          data-testid={`cal-cell-${key}`}
          style={{
            cursor: "pointer",
            padding: "2px 4px",
            background: `${repColor}22`,
            borderLeft: `3px solid ${repColor}`,
            borderRadius: 3,
            fontSize: 12,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <Text strong style={{ color: repColor, fontSize: 12 }}>
            {items.length} 条
          </Text>
        </div>
      </Popover>
    );
  };

  if (nodes.length === 0) {
    return <Empty description="暂无攻关单" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  return (
    <div data-testid="attack-calendar">
      <Space style={{ marginBottom: 12 }}>
        <Text>按时间字段:</Text>
        <Switch
          checkedChildren="更新时间"
          unCheckedChildren="创建时间"
          checked={byUpdated}
          onChange={setByUpdated}
          data-testid="cal-by-updated"
        />
        <Space size={8} style={{ marginLeft: 16 }}>
          <Tag color="red">P0/P1</Tag>
          <Tag color="orange">P2</Tag>
          <Tag color="blue">P3+</Tag>
        </Space>
      </Space>
      <Calendar fullscreen dateCellRender={dateCellRender} />
    </div>
  );
}
