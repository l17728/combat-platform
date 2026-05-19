import React from "react";
import { Layout, Menu } from "antd";
import { Link, useLocation } from "react-router-dom";
import type { ReactNode } from "react";

const ITEMS = [
  { key: "/", label: <Link to="/">首页</Link> },
  { key: "/attack", label: <Link to="/attack">攻关作战台</Link> },
  { key: "/honor", label: <Link to="/honor">荣誉殿堂</Link> },
  { key: "/contributions", label: <Link to="/contributions">贡献录入</Link> },
  { key: "/import", label: <Link to="/import">导入</Link> },
  { key: "/proposals", label: <Link to="/proposals">关系审批</Link> },
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
