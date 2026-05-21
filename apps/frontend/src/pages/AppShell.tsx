import React from "react";
import { Layout, Menu } from "antd";
import { Link, useLocation } from "react-router-dom";
import type { ReactNode } from "react";

const VIEW_TABLES = [
  { key: "/incidents", label: <Link to="/incidents">现网问题跟踪</Link> },
  { key: "/changes", label: <Link to="/changes">变更相关问题</Link> },
  { key: "/alarms", label: <Link to="/alarms">告警治理跟踪</Link> },
  { key: "/p3", label: <Link to="/p3">未闭环P3事件单</Link> },
  { key: "/daily", label: <Link to="/daily">日常事项跟踪</Link> },
  { key: "/issue400", label: <Link to="/issue400">现网400问题梳理</Link> },
  { key: "/issue5xx", label: <Link to="/issue5xx">现网5xx问题梳理</Link> },
  { key: "/experience", label: <Link to="/experience">经验总结</Link> },
];

const ITEMS = [
  { key: "/", label: <Link to="/">首页</Link> },
  { key: "/attack", label: <Link to="/attack">攻关作战台</Link> },
  { key: "views", label: "作战表", children: VIEW_TABLES },
  { key: "/honor", label: <Link to="/honor">荣誉殿堂</Link> },
  { key: "/contributions", label: <Link to="/contributions">贡献录入</Link> },
  { key: "/import", label: <Link to="/import">导入</Link> },
  { key: "/proposals", label: <Link to="/proposals">关系审批</Link> },
  { key: "/search", label: <Link to="/search">信息检索</Link> },
  { key: "/releases", label: <Link to="/releases">发布包</Link> },
  { key: "/weights", label: <Link to="/weights">权重文件</Link> },
  { key: "/daily-report", label: <Link to="/daily-report">攻关日报</Link> },
  { key: "/reminders", label: <Link to="/reminders">跟催提醒</Link> },
  { key: "/conflicts", label: <Link to="/conflicts"><span style={{ color: "#cf1322" }}>冲突</span></Link> },
  { key: "/hermes", label: <Link to="/hermes">Hermes 问答</Link> },
  { key: "/audit", label: <Link to="/audit">审计日志</Link> },
  { key: "/merge", label: <Link to="/merge">人员合并</Link> },
  { key: "/escalation", label: <Link to="/escalation">SLA上升</Link> },
  { key: "/oncall", label: <Link to="/oncall">Oncall</Link> },
  { key: "/email", label: <Link to="/email">邮件</Link> },
  { key: "/emailgroups", label: <Link to="/emailgroups">邮件群组</Link> },
];

export function AppShell({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const selected = ITEMS.map(i => i.key)
    .filter(k => (k === "/" ? loc.pathname === "/" : loc.pathname.startsWith(k)))
    .sort((a, b) => b.length - a.length)[0] ?? "/";
  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Layout.Header style={{ display: "flex", alignItems: "center" }}>
        <div style={{ color: "#fff", fontWeight: 700, marginRight: 24 }}>作战平台</div>
        <Menu theme="dark" mode="horizontal" selectedKeys={[selected]} items={ITEMS} style={{ flex: 1 }} />
      </Layout.Header>
      <Layout.Content>{children}</Layout.Content>
    </Layout>
  );
}
