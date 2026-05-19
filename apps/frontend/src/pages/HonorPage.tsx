import { useEffect, useState } from "react";
import { Table, Input } from "antd";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import type { LeaderboardEntry } from "@combat/shared";

export function HonorPage() {
  const [rows, setRows] = useState<LeaderboardEntry[]>([]);
  const [period, setPeriod] = useState("");
  useEffect(() => { api.getLeaderboard(period || undefined).then(setRows); }, [period]);
  const columns = [
    { title: "名次", dataIndex: "__rank", render: (_: unknown, __: LeaderboardEntry, i: number) => i + 1 },
    { title: "贡献人", dataIndex: "贡献人",
      render: (v: string) => <Link to={`/honor/${encodeURIComponent(v)}`}>{v}</Link> },
    { title: "加权得分", dataIndex: "score" },
    { title: "贡献数", dataIndex: "贡献数" },
    { title: "各等级", dataIndex: "byLevel",
      render: (b: Record<string, number>) => Object.entries(b).map(([k, n]) => `${k}:${n}`).join(" ") },
  ];
  return (
    <div style={{ padding: 16 }}>
      <h2>荣誉殿堂</h2>
      <Input.Search aria-label="period-filter" placeholder="按周期过滤(如 2026-Q2)" allowClear
        onSearch={setPeriod} style={{ width: 240, marginBottom: 12 }} />
      <Table rowKey="贡献人" dataSource={rows} columns={columns} pagination={false} />
    </div>
  );
}
