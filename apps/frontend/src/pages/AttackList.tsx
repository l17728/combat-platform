import { useEffect, useState } from "react";
import { Table, Input } from "antd";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import type { GraphNode, NodeSchema } from "@combat/shared";

export function AttackList() {
  const [rows, setRows] = useState<GraphNode[]>([]);
  const [schema, setSchema] = useState<NodeSchema | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  useEffect(() => { api.getSchema("attackTicket").then(setSchema); }, []);
  useEffect(() => {
    api.listNodes("attackTicket", statusFilter ? { 状态: statusFilter } : {}).then(setRows);
  }, [statusFilter]);
  const columns = (schema?.fields ?? []).map(f => ({
    title: f.label, dataIndex: f.name,
    render: (_: unknown, r: GraphNode) =>
      f.name === "标题"
        ? <Link to={`/attack/${r.id}`}>{String(r.properties[f.name] ?? "")}</Link>
        : String(r.properties[f.name] ?? ""),
  }));
  return (
    <div style={{ padding: 16 }}>
      <h2>攻关作战台</h2>
      <Input.Search placeholder="按状态过滤" allowClear
        aria-label="status-filter"
        onSearch={setStatusFilter} style={{ width: 240, marginBottom: 12 }} />
      <Table rowKey="id" dataSource={rows} columns={columns} pagination={false} />
    </div>
  );
}
