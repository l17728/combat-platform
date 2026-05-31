import { useMemo, useState, useCallback } from "react";
import { Card, Typography, Tag, Tooltip, Empty, Space, Select, message } from "antd";
import { LockOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import type { GraphNode, NodeSchema } from "@combat/shared";
import { api } from "../../api.js";
import { STATUS_COLOR } from "../../constants.js";
import { handleApiError } from "../../utils/handleApiError.js";

const { Text } = Typography;

interface Props {
  nodes: GraphNode[];
  schema: NodeSchema | null;
  onChanged: () => void;
  statusValues?: string[];
}

const DEFAULT_STATUS = ["待响应", "处理中", "进行中", "已解决", "已关闭"];

export default function AttackKanban({ nodes, schema, onChanged, statusValues }: Props) {
  const navigate = useNavigate();
  // 列(列 = 状态枚举值):优先用 schema 的 enumValues,fallback 写死;允许外部 override
  const columns = useMemo(() => {
    if (statusValues && statusValues.length > 0) return statusValues;
    const f = schema?.fields.find((x) => x.name === "状态");
    return f?.enumValues && f.enumValues.length > 0 ? f.enumValues : DEFAULT_STATUS;
  }, [schema, statusValues]);

  // 乐观更新本地副本: 拖拽落地立即移动,失败再回滚
  const [localNodes, setLocalNodes] = useState<GraphNode[]>(nodes);
  // 父组件刷新数据时同步本地副本(简单:用 nodes 长度+id 集做依赖)
  const nodesKey = nodes.map((n) => n.id + ":" + (n.properties["状态"] ?? "")).join("|");
  // useMemo 跟踪 key 变化,触发 setLocalNodes
  useMemo(() => {
    setLocalNodes(nodes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodesKey]);

  const grouped = useMemo(() => {
    const g: Record<string, GraphNode[]> = {};
    for (const c of columns) g[c] = [];
    for (const n of localNodes) {
      const s = String(n.properties["状态"] ?? "").trim();
      if (g[s]) g[s].push(n);
      else if (g[columns[0]]) g[columns[0]].push(n);
    }
    return g;
  }, [localNodes, columns]);

  const [draggingId, setDraggingId] = useState<string | null>(null);

  const moveCard = useCallback(
    async (id: string, toStatus: string) => {
      const target = localNodes.find((n) => n.id === id);
      if (!target) return;
      const fromStatus = String(target.properties["状态"] ?? "");
      if (fromStatus === toStatus) return;
      // 乐观更新
      setLocalNodes((prev) =>
        prev.map((n) => (n.id === id ? { ...n, properties: { ...n.properties, 状态: toStatus } } : n))
      );
      try {
        await api.transition(id, toStatus, "看板拖拽");
        message.success(`已流转: ${fromStatus} → ${toStatus}`);
        onChanged();
      } catch (e) {
        // 回滚
        setLocalNodes((prev) =>
          prev.map((n) => (n.id === id ? { ...n, properties: { ...n.properties, 状态: fromStatus } } : n))
        );
        handleApiError(e, "状态流转失败");
      }
    },
    [localNodes, onChanged]
  );

  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
    setDraggingId(id);
  };

  const handleDragEnd = () => setDraggingId(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent, toStatus: string) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain") || draggingId;
    setDraggingId(null);
    if (id) moveCard(id, toStatus);
  };

  if (localNodes.length === 0) {
    return <Empty description="暂无攻关单" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  return (
    <div
      data-testid="attack-kanban"
      style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 8, minHeight: 480 }}
    >
      {columns.map((col) => {
        const items = grouped[col] || [];
        const colorTag = STATUS_COLOR[col] || "default";
        return (
          <div
            key={col}
            data-testid={`kanban-col-${col}`}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, col)}
            style={{
              flex: "0 0 280px",
              background: "#fafafa",
              border: "1px solid #f0f0f0",
              borderRadius: 6,
              padding: 8,
              display: "flex",
              flexDirection: "column",
              maxHeight: "calc(100vh - 280px)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8,
                paddingBottom: 6,
                borderBottom: "1px solid #e8e8e8",
              }}
            >
              <Space size={6}>
                <Tag color={colorTag} style={{ margin: 0 }}>
                  {col}
                </Tag>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {items.length}
                </Text>
              </Space>
            </div>
            <div style={{ overflowY: "auto", flex: 1, paddingRight: 4 }}>
              {items.length === 0 ? (
                <div
                  style={{
                    padding: "16px 8px",
                    textAlign: "center",
                    color: "#bfbfbf",
                    fontSize: 12,
                  }}
                >
                  拖到这里改为「{col}」
                </div>
              ) : (
                items.map((n) => (
                  <KanbanCard
                    key={n.id}
                    node={n}
                    columns={columns}
                    onDragStart={(e) => handleDragStart(e, n.id)}
                    onDragEnd={handleDragEnd}
                    onClick={() => navigate(`/attack/${n.id}`)}
                    onMoveTo={(to) => moveCard(n.id, to)}
                    isDragging={draggingId === n.id}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface CardProps {
  node: GraphNode;
  columns: string[];
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onClick: () => void;
  onMoveTo: (to: string) => void;
  isDragging: boolean;
}

function KanbanCard({ node, columns, onDragStart, onDragEnd, onClick, onMoveTo, isDragging }: CardProps) {
  const p = node.properties;
  const title = String(p["标题"] ?? "(未命名)");
  const level = String(p["事件级别"] ?? "");
  const handler = String(p["当前处理人"] ?? "");
  const customer = String(p["客户名称"] ?? "");
  const currentStatus = String(p["状态"] ?? "");
  const isPrivate = String(p["私密"] ?? "") === "是";
  // 卡片可视化时长尽量克制(4-6 行)
  return (
    <Card
      size="small"
      hoverable
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={(e) => {
        // Select 内点击不触发跳详情
        if ((e.target as HTMLElement).closest(".ant-select")) return;
        onClick();
      }}
      data-testid={`kanban-card-${node.id}`}
      style={{
        marginBottom: 8,
        cursor: "grab",
        opacity: isDragging ? 0.5 : 1,
        boxShadow: isDragging ? "0 4px 12px rgba(0,0,0,0.15)" : undefined,
      }}
      bodyStyle={{ padding: "8px 10px" }}
    >
      <div style={{ fontWeight: 500, marginBottom: 4, lineHeight: 1.4 }}>
        {isPrivate && (
          <Tooltip title="私密攻关单">
            <LockOutlined style={{ color: "#fa8c16", marginRight: 4 }} />
          </Tooltip>
        )}
        {title}
      </div>
      <Space size={4} wrap style={{ marginBottom: 4 }}>
        {level && <Tag color="orange" style={{ margin: 0 }}>{level}</Tag>}
        {handler && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            处理人: {handler}
          </Text>
        )}
      </Space>
      {customer && (
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            客户: {customer}
          </Text>
        </div>
      )}
      {/* DnD 降级 — 不支持拖拽的浏览器/E2E 也能改状态 */}
      <div style={{ marginTop: 6 }} onClick={(e) => e.stopPropagation()}>
        <Select
          size="small"
          value={currentStatus}
          onChange={(v) => onMoveTo(v)}
          options={columns.map((c) => ({ value: c, label: c }))}
          style={{ width: "100%" }}
          data-testid={`kanban-select-${node.id}`}
        />
      </div>
    </Card>
  );
}
