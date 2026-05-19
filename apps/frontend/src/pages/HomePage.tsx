import { useEffect, useState } from "react";
import { Card, Row, Col, Statistic, Descriptions, message } from "antd";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import type { DashboardSummary } from "@combat/shared";

const MODULES = [
  { to: "/attack", title: "攻关作战台", desc: "攻关单跟踪、进展、可编辑表格" },
  { to: "/honor", title: "荣誉殿堂", desc: "贡献加权排行榜与个人档案" },
  { to: "/contributions", title: "贡献录入", desc: "记录贡献并关联攻关单" },
  { to: "/import", title: "导入", desc: "从 Excel 导入数据" },
  { to: "/proposals", title: "关系审批", desc: "候选关系扫描与人工审批" },
  { to: "/search", title: "信息检索", desc: "跨攻关/贡献/关联的只读检索（Hermes 契约）" },
];

export function HomePage() {
  const [dash, setDash] = useState<DashboardSummary | null>(null);
  useEffect(() => {
    api.getDashboard().then(setDash).catch(() => message.error("大盘加载失败"));
  }, []);
  return (
    <div style={{ padding: 24 }}>
      <h1>作战平台</h1>
      {dash && (
        <div aria-label="dashboard" style={{ marginBottom: 24 }}>
          <Row gutter={16}>
            <Col><Statistic title="攻关单总数" value={dash.tickets.total} /></Col>
            <Col><Statistic title="进行中" value={dash.tickets.open} /></Col>
            <Col><Statistic title="已闭环" value={dash.tickets.resolved} /></Col>
            <Col><Statistic title="贡献总数" value={dash.contributions.total} /></Col>
            <Col><Statistic title="待审批提议" value={dash.proposalsPending} /></Col>
          </Row>
          <Descriptions size="small" column={1} style={{ marginTop: 12 }}>
            <Descriptions.Item label="状态分布">
              {Object.entries(dash.tickets.byStatus).map(([s, n]) => `${s || "(空)"}: ${n}`).join("　") || "无"}
            </Descriptions.Item>
            <Descriptions.Item label="Top 贡献人">
              {dash.contributions.topContributors.map(c => `${c.贡献人}×${c.count}`).join("　") || "无"}
            </Descriptions.Item>
          </Descriptions>
        </div>
      )}
      <Row gutter={[16, 16]}>
        {MODULES.map(m => (
          <Col span={8} key={m.to}>
            <Link to={m.to}>
              <Card hoverable title={m.title} aria-label={`home-card-${m.to}`}>{m.desc}</Card>
            </Link>
          </Col>
        ))}
      </Row>
    </div>
  );
}
