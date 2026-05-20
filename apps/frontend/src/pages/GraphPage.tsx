import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Select, Space, Typography, message } from "antd";
import { api } from "../api.js";
import type { GraphSnapshot, GraphSnapshotNode } from "@combat/shared";

const EDGE_COLOR: Record<string, string> = {
  REF: "#1677ff",
  ANCHORED_TO: "#722ed1",
  CONFLICTS_WITH: "#cf1322",
  OVERLAPS_WITH: "#fa8c16",
};
const EDGE_LABEL: Record<string, string> = {
  REF: "REF（引用）",
  ANCHORED_TO: "ANCHORED_TO（锚点）",
  CONFLICTS_WITH: "CONFLICTS_WITH（冲突）",
  OVERLAPS_WITH: "OVERLAPS_WITH（重叠）",
};

const W = 800, H = 600;
const CX = W / 2, CY = H / 2;

function detailLink(n: GraphSnapshotNode): string {
  return n.nodeType === "attackTicket" ? `/graph/attackTicket/${n.id}` : `/graph/${n.nodeType}/${n.id}`;
}

export function GraphPage() {
  const { nodeType = "", id = "" } = useParams();
  const nav = useNavigate();
  const [depth, setDepth] = useState(1);
  const [data, setData] = useState<GraphSnapshot | null>(null);

  useEffect(() => {
    api.graphSnapshot(nodeType, id, depth).then(setData)
      .catch((e) => message.error(String((e as Error).message)));
  }, [nodeType, id, depth]);

  // Compute deterministic radial layout: root at (CX, CY), other nodes
  // distributed evenly on a single ring (depth=1 keeps it readable).
  const positions = useMemo(() => {
    const pos = new Map<string, { x: number; y: number }>();
    if (!data) return pos;
    pos.set(data.rootId, { x: CX, y: CY });
    const others = data.nodes.filter(n => n.id !== data.rootId);
    const RADIUS = 220;
    others.forEach((n, i) => {
      const theta = (i / Math.max(1, others.length)) * 2 * Math.PI - Math.PI / 2;
      pos.set(n.id, { x: CX + RADIUS * Math.cos(theta), y: CY + RADIUS * Math.sin(theta) });
    });
    return pos;
  }, [data]);

  return (
    <div style={{ padding: 16 }}>
      <Typography.Title level={3}>图形视图：{nodeType} / {id}</Typography.Title>
      <Space style={{ marginBottom: 8 }}>
        <span>深度：</span>
        <Select aria-label="graph-depth" value={depth} onChange={setDepth} style={{ width: 80 }}
          options={[{ value: 1, label: "1" }, { value: 2, label: "2" }, { value: 3, label: "3" }]} />
        <Typography.Text type="secondary">点击节点钻取；4 种派生边类型用不同颜色区分</Typography.Text>
      </Space>
      <div style={{ marginBottom: 8 }} aria-label="graph-legend">
        {Object.entries(EDGE_LABEL).map(([k, v]) => (
          <span key={k} style={{ marginRight: 16, color: EDGE_COLOR[k] }}>● {v}</span>
        ))}
      </div>
      {data && data.nodes.length > 0 ? (
        <svg aria-label="graph-svg" width={W} height={H} style={{ border: "1px solid #d9d9d9", background: "#fafafa" }}>
          {data.edges.map((e, i) => {
            const a = positions.get(e.source), b = positions.get(e.target);
            if (!a || !b) return null;
            return (
              <line key={`e-${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={EDGE_COLOR[e.edgeType] ?? "#999"} strokeWidth={2} opacity={0.7} />
            );
          })}
          {data.nodes.map((n) => {
            const p = positions.get(n.id);
            if (!p) return null;
            const isRoot = n.id === data.rootId;
            return (
              <g key={n.id} aria-label={`graph-node-${n.id}`} style={{ cursor: "pointer" }}
                 onClick={() => { if (!isRoot) nav(detailLink(n)); }}>
                <circle cx={p.x} cy={p.y} r={isRoot ? 28 : 22}
                  fill={isRoot ? "#1677ff" : "#fff"}
                  stroke={isRoot ? "#003eb3" : "#1677ff"} strokeWidth={2} />
                <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize={11}
                  fill={isRoot ? "#fff" : "#333"}>
                  {n.label.length > 8 ? n.label.slice(0, 7) + "…" : n.label}
                </text>
                <text x={p.x} y={p.y + (isRoot ? 44 : 38)} textAnchor="middle" fontSize={10} fill="#888">
                  [{n.nodeType}]
                </text>
              </g>
            );
          })}
        </svg>
      ) : (
        <Typography.Paragraph type="secondary">暂无节点</Typography.Paragraph>
      )}
    </div>
  );
}
