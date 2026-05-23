import { useEffect, useState } from "react";
import { Table, Tag, Space, Typography, Select, message } from "antd";
import { api } from "../api.js";
import type { GraphNode, NodeSchema } from "@combat/shared";

const STATUS_COLORS: Record<string, string> = {
  "待处理": "orange", "进行中": "blue", "已完成": "green", "已取消": "default",
};

export function TasksPage() {
  const [rows, setRows] = useState<GraphNode[]>([]);
  const [schema, setSchema] = useState<NodeSchema | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");

  useEffect(() => {
    api.listNodes("dailyTask", statusFilter ? { 状态: statusFilter } : {})
      .then(setRows).catch(() => message.error("加载失败"));
    api.getSchema("dailyTask").then(setSchema).catch(() => {});
  }, [statusFilter]);

  const statusField = schema?.fields.find(f => f.name === "状态");

  const columns = [
    {
      title: "标题", key: "title",
      render: (_: unknown, r: GraphNode) => String(r.properties["标题"] ?? r.properties["title"] ?? r.id),
    },
    {
      title: "状态", key: "status",
      render: (_: unknown, r: GraphNode) => {
        const s = String(r.properties["状态"] ?? "");
        return s ? <Tag color={STATUS_COLORS[s] ?? "default"}>{s}</Tag> : <span>—</span>;
      },
    },
    ...(schema?.fields
      .filter(f => f.name !== "标题" && f.name !== "title" && f.name !== "状态" && !f.retired)
      .slice(0, 3)
      .map(f => ({
        title: f.label, key: f.name,
        render: (_: unknown, r: GraphNode) => String(r.properties[f.name] ?? "—"),
      })) ?? []),
  ];

  return (
    <div style={{ padding: 24 }}>
      <Space style={{ marginBottom: 16 }} wrap>
        <Typography.Title level={3} style={{ margin: 0 }}>任务台</Typography.Title>
        {statusField && (
          <Select placeholder="按状态筛选" allowClear style={{ width: 160 }}
            onChange={(v: string | undefined) => setStatusFilter(v ?? "")}
            value={statusFilter || undefined}>
            {(statusField.enumValues ?? []).map(v => (
              <Select.Option key={v} value={v}>{v}</Select.Option>
            ))}
          </Select>
        )}
      </Space>
      <Table rowKey="id" dataSource={rows} columns={columns}
        pagination={{ pageSize: 20 }} size="middle" />
    </div>
  );
}
