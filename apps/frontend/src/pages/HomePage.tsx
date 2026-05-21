import { useEffect, useState } from "react";
import { Card, Row, Col, Statistic, Descriptions, List, Tag, Typography, message } from "antd";
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
  { to: "/releases", title: "发布包", desc: "版本发布包元数据 + 下载链接登记（李嘉⑤）" },
  { to: "/weights", title: "权重文件", desc: "模型权重文件元数据 + 存储链接登记（李嘉⑥）" },
  { to: "/daily-report", title: "攻关日报", desc: "自动汇总当日各攻关单进展，复制到剪贴板（待外发渠道接入）" },
  { to: "/reminders", title: "跟催提醒", desc: "问题单跟催 / FE Deadline 提醒（当前为 stub 渠道）" },
  { to: "/hermes", title: "Hermes 问答", desc: "中文规则问答 MVP：状态/负责人/问题单/负载/全文（无 LLM 凭据可用）" },
  { to: "/audit", title: "审计日志", desc: "所有写操作的留痕（CREATE/UPDATE/DELETE/SCHEMA）" },
  { to: "/merge", title: "人员合并", desc: "实体解析手动层：合并同一人的多条记录（不可逆）" },
  { to: "/email", title: "邮件", desc: "SMTP 配置 + 发送通知邮件" },
  { to: "/emailgroups", title: "邮件群组", desc: "增删改查邮件群组" },
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
          <div aria-label="dashboard-extras" style={{ marginTop: 12 }}>
            <Descriptions size="small" column={1}>
              <Descriptions.Item label={<span style={{ color: "#cf1322" }}>冲突 / 重叠</span>}>
                <span style={{ color: "#cf1322" }}>{dash.conflicts.count} 对</span>
                {dash.conflicts.topReasons.length > 0 && (
                  <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
                    （{dash.conflicts.topReasons.slice(0, 3).join("　")}）
                  </Typography.Text>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="今日动态">
                {dash.today.progressEntries} 条进展 / {dash.today.ticketsTouched} 个攻关单
              </Descriptions.Item>
            </Descriptions>
            {dash.recentActivity.length > 0 && (
              <div aria-label="recent-activity" style={{ marginTop: 8 }}>
                <Typography.Text strong>最近活跃攻关单</Typography.Text>
                <List size="small" dataSource={dash.recentActivity}
                  rowKey={(r) => r.ticketId}
                  renderItem={(r) => (
                    <List.Item>
                      <Link to={`/attack/${r.ticketId}`}>{r.标题}</Link>
                      <Tag style={{ marginLeft: 8 }}>{r.状态 || "未填"}</Tag>
                      <Typography.Text type="secondary" style={{ marginLeft: 8 }}>{r.lastChangedAt}</Typography.Text>
                    </List.Item>
                  )} />
              </div>
            )}
          </div>
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
        <Col span={8} key="/conflicts">
          <Link to="/conflicts">
            <Card hoverable
              aria-label="home-card-conflicts"
              title={<span style={{ color: "#cf1322" }}>冲突 / 重叠</span>}
              style={{ border: "1px solid #cf1322" }}
            >
              同负责人多并发 / 同问题单号重叠的攻关单红色高亮
            </Card>
          </Link>
        </Col>
      </Row>
    </div>
  );
}
