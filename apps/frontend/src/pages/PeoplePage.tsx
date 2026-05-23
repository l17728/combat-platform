import { useEffect, useState } from "react";
import { Table, Space, Typography, Tag, Input, message } from "antd";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import type { GraphNode, NodeSchema } from "@combat/shared";

export function PeoplePage() {
  const [rows, setRows] = useState<GraphNode[]>([]);
  const [schema, setSchema] = useState<NodeSchema | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    api.listNodes("person").then(setRows).catch(() => message.error("加载失败"));
    api.getSchema("person").then(setSchema).catch(() => {});
  }, []);

  const filtered = rows.filter(r =>
    !search || Object.values(r.properties).some(v => String(v).includes(search))
  );

  const columns = [
    {
      title: "姓名", key: "name",
      render: (_: unknown, r: GraphNode) => {
        const name = String(r.properties["name"] ?? r.properties["姓名"] ?? r.id);
        return <Link to={`/honor/${name}`}>{name}</Link>;
      },
    },
    {
      title: "团队", key: "team",
      render: (_: unknown, r: GraphNode) => {
        const t = String(r.properties["团队"] ?? "");
        return t ? <Tag>{t}</Tag> : "—";
      },
    },
    ...(schema?.fields
      .filter(f => f.name !== "name" && f.name !== "团队" && !f.retired)
      .slice(0, 3)
      .map(f => ({
        title: f.label, key: f.name,
        render: (_: unknown, r: GraphNode) => String(r.properties[f.name] ?? "—"),
      })) ?? []),
    {
      title: "操作", key: "actions",
      render: (_: unknown, r: GraphNode) => {
        const name = String(r.properties["name"] ?? r.properties["姓名"] ?? r.id);
        return (
          <Space>
            <Link to={`/honor/${name}`}>荣誉档案</Link>
            <Link to={`/related/person/${r.id}`}>关联全景</Link>
          </Space>
        );
      },
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Space style={{ marginBottom: 16 }} wrap>
        <Typography.Title level={3} style={{ margin: 0 }}>人员台</Typography.Title>
        <Input.Search placeholder="搜索人员" style={{ width: 240 }} allowClear
          onSearch={setSearch} onChange={e => !e.target.value && setSearch("")} />
      </Space>
      <Table rowKey="id" dataSource={filtered} columns={columns}
        pagination={{ pageSize: 20 }} size="middle" />
    </div>
  );
}
