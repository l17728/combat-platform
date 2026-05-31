import { useState, useEffect, useCallback } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { Layout, Menu, Select, Space, Typography, theme, Dropdown, Button, Avatar, Tooltip } from "antd";
import BreadcrumbBar from "../components/BreadcrumbBar.js";
import NotificationBell from "../components/NotificationBell.js";
import {
  DashboardOutlined,
  ThunderboltOutlined,
  TeamOutlined,
  TrophyOutlined,
  MailOutlined,
  ToolOutlined,
  ImportOutlined,
  SettingOutlined,
  FileSearchOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  FileTextOutlined,
  MergeOutlined,
  ApartmentOutlined,
  TableOutlined,
  ControlOutlined,
  SearchOutlined,
  DeploymentUnitOutlined,
  AuditOutlined,
  BellOutlined,
  BugOutlined,
  UserOutlined,
  LogoutOutlined,
  DownOutlined,
  EyeOutlined,
  DatabaseOutlined,
  CloudUploadOutlined,
  ApiOutlined,
  QuestionCircleOutlined,
  MoonOutlined,
  SunOutlined,
} from "@ant-design/icons";
import type { MenuProps } from "antd";
import { useAuth } from "../hooks/useAuth.js";
import FloatingFeedback from "../components/FloatingFeedback.js";
import HermesChat from "../components/HermesChat.js";
import CommandPalette from "../components/CommandPalette.js";
import { useThemeContext } from "../hooks/useTheme.js";
import { resetAllTours } from "../components/ProductTour.js";

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

function getSelectedKey(path: string): string {
  if (path.startsWith("/attack")) return "/attack";
  if (path === "/people" || path.startsWith("/honor")) return "/people";
  if (path === "/contributions") return "/contributions";
  if (path === "/daily-report") return "/daily-report";
  if (path === "/help") return "/help";
  if (path === "/proposals") return "/proposals";
  if (path === "/reminders") return "/reminders";
  if (path.startsWith("/related")) return "/attack";
  if (["/search", "/kg", "/documents", "/bug-report", "/manual"].includes(path)) return path;
  if (
    [
      "/import",
      "/email",
      "/llm-settings",
      "/audit",
      "/schema",
      "/config",
      "/users",
      "/op-log",
      "/backup",
      "/merge",
      "/db-migration",
      "/system-upgrade",
    ].includes(path)
  )
    return path;
  return "/";
}

function getOpenKeysForPath(path: string): string[] {
  if (path.startsWith("/attack") || path.startsWith("/daily-report") || path.startsWith("/related")) return ["attack"];
  if (path === "/people" || path === "/contributions" || path.startsWith("/honor")) return ["people"];
  if (path === "/proposals" || path === "/reminders") return ["system", "review"];
  if (
    [
      "/import",
      "/email",
      "/llm-settings",
      "/audit",
      "/schema",
      "/config",
      "/users",
      "/op-log",
      "/backup",
      "/merge",
      "/db-migration",
      "/system-upgrade",
    ].includes(path)
  )
    return ["system"];
  if (["/documents", "/search", "/kg", "/bug-report", "/manual"].includes(path)) return ["tools"];
  return [];
}

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  const navigate = useNavigate();
  const location = useLocation();
  const { token } = theme.useToken();
  const { user, logout, isAdmin } = useAuth();
  const { isDark, toggleMode } = useThemeContext();

  const [openKeys, setOpenKeys] = useState<string[]>(getOpenKeysForPath(location.pathname));

  const handleResize = useCallback(() => {
    if (window.innerWidth < 768) setCollapsed(true);
  }, []);

  useEffect(() => {
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [handleResize]);

  useEffect(() => {
    setOpenKeys(getOpenKeysForPath(location.pathname));
  }, [location.pathname]);

  const currentRole = (typeof localStorage !== "undefined" && localStorage.getItem("combat-role")) || "normal";

  const selectedKeys = [getSelectedKey(location.pathname)];

  const menuItems: MenuProps["items"] = [
    {
      key: "/",
      icon: <DashboardOutlined />,
      label: "作战态势",
    },
    {
      key: "attack",
      icon: <ThunderboltOutlined />,
      label: "攻关管理",
      onTitleClick: () => navigate("/attack"),
      children: [
        { key: "/attack", label: "攻关作战台" },
        { key: "/daily-report", label: "攻关日报", icon: <FileTextOutlined /> },
      ],
    },
    {
      key: "people",
      icon: <TeamOutlined />,
      label: "人员与荣誉",
      onTitleClick: () => navigate("/people"),
      children: [
        { key: "/people", label: "全员名单" },
        { key: "/contributions", label: "贡献录入" },
        { key: "/honor", label: "荣誉殿堂", icon: <TrophyOutlined /> },
      ],
    },
    {
      key: "/help",
      icon: <MailOutlined />,
      label: "求助中心",
    },
    {
      key: "tools",
      icon: <ToolOutlined />,
      label: "工具",
      onTitleClick: () => navigate("/search"),
      children: [
        { key: "/search", label: "全局搜索", icon: <SearchOutlined /> },
        { key: "/kg", label: "知识图谱", icon: <DeploymentUnitOutlined /> },
        { key: "/documents", label: "文档中心", icon: <FileTextOutlined /> },
        { key: "/bug-report", label: "问题反馈", icon: <BugOutlined /> },
        { key: "/manual", label: "帮助中心", icon: <QuestionCircleOutlined /> },
      ],
    },
    {
      key: "system",
      icon: <SettingOutlined />,
      label: "系统管理",
      onTitleClick: () => navigate("/import"),
      children: [
        { key: "/import", label: "数据导入/导出", icon: <ImportOutlined /> },
        { key: "/schema", label: "表结构管理", icon: <TableOutlined /> },
        { key: "/config", label: "配置中心", icon: <ControlOutlined /> },
        { key: "/email", label: "邮件设置", icon: <SettingOutlined /> },
        { key: "/digest", label: "邮件摘要", icon: <MailOutlined /> },
        ...(isAdmin ? [{ key: "/llm-settings", label: "LLM 设置", icon: <ThunderboltOutlined /> }] : []),
        { key: "/audit", label: "审计日志", icon: <FileSearchOutlined /> },
        { key: "/backup", label: "备份恢复", icon: <DatabaseOutlined /> },
        ...(isAdmin ? [{ key: "/merge", label: "人员合并", icon: <MergeOutlined /> }] : []),
        ...(isAdmin ? [{ key: "/system-upgrade", label: "系统升级", icon: <CloudUploadOutlined /> }] : []),
        ...(isAdmin ? [{ key: "/db-migration", label: "数据库迁移", icon: <DatabaseOutlined /> }] : []),
        ...(isAdmin
          ? [
              {
                key: "review",
                icon: <AuditOutlined />,
                label: "审核管理",
                children: [
                  { key: "/proposals", label: "关系审批", icon: <ApartmentOutlined /> },
                  { key: "/reminders", label: "跟催提醒", icon: <BellOutlined /> },
                ],
              },
            ]
          : []),
        ...(isAdmin ? [{ key: "/op-log", label: "操作追踪", icon: <EyeOutlined /> }] : []),
        ...(isAdmin ? [{ key: "/webhooks", label: "Webhook 订阅", icon: <ApiOutlined /> }] : []),
        ...(isAdmin ? [{ key: "/users", label: "用户管理", icon: <UserOutlined /> }] : []),
      ],
    },
  ];

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        trigger={null}
        width={200}
        collapsedWidth={64}
        style={{
          borderRight: `1px solid ${token.colorBorderSecondary}`,
          overflow: "auto",
          height: "100vh",
          position: "fixed",
          left: 0,
          top: 0,
          bottom: 0,
        }}
      >
        <div
          data-testid="sider-logo"
          onClick={() => navigate("/")}
          style={{
            height: 48,
            display: "flex",
            alignItems: "center",
            justifyContent: collapsed ? "center" : "flex-start",
            padding: collapsed ? 0 : "0 20px",
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            cursor: "pointer",
          }}
        >
          {collapsed ? (
            <ThunderboltOutlined style={{ fontSize: 20, color: token.colorPrimary }} />
          ) : (
            <Text strong style={{ fontSize: 16, color: token.colorPrimary, whiteSpace: "nowrap" }}>
              作战平台
            </Text>
          )}
        </div>
        <Menu
          mode="inline"
          selectedKeys={selectedKeys}
          openKeys={collapsed ? [] : openKeys}
          onOpenChange={(keys) => setOpenKeys(keys)}
          onClick={({ key }) => {
            if (key.startsWith("/")) navigate(key);
          }}
          items={menuItems}
          style={{ borderRight: "none" }}
        />
      </Sider>

      <Layout style={{ marginLeft: collapsed ? 64 : 200, transition: "margin-left 0.2s" }}>
        <Header
          style={{
            height: 48,
            padding: "0 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            background: token.colorBgContainer,
            position: "sticky",
            top: 0,
            zIndex: 10,
          }}
        >
          <Space>
            <span
              data-testid="sidebar-toggle"
              onClick={() => setCollapsed(!collapsed)}
              style={{ cursor: "pointer", fontSize: 18, lineHeight: "48px" }}
            >
              {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            </span>
          </Space>
          <Space size="middle">
            <Tooltip title={isDark ? "切换亮色" : "切换暗色"}>
              <span
                onClick={toggleMode}
                style={{ cursor: "pointer", fontSize: 16, lineHeight: "48px" }}
                data-testid="theme-toggle"
              >
                {isDark ? <SunOutlined /> : <MoonOutlined />}
              </span>
            </Tooltip>
            <NotificationBell />
            <Dropdown
              menu={{
                items: [
                  {
                    key: "role",
                    label: (
                      <span>
                        角色: {user?.role === "admin" ? "管理员" : user?.role === "leader" ? "Leader" : "普通成员"}
                      </span>
                    ),
                    disabled: true,
                  },
                  { type: "divider" },
                  ...(isAdmin ? [{ key: "/users", label: "用户管理", icon: <UserOutlined /> }] : []),
                  { type: "divider" },
                  { key: "replay-tour", label: "重播引导", icon: <QuestionCircleOutlined /> },
                  { key: "logout", label: "退出登录", icon: <LogoutOutlined />, danger: true },
                ],
                onClick: ({ key }) => {
                  if (key === "logout") {
                    logout();
                    navigate("/login");
                  } else if (key === "replay-tour") {
                    resetAllTours();
                    window.location.reload();
                  } else if (key.startsWith("/")) navigate(key);
                },
              }}
            >
              <Space style={{ cursor: "pointer" }}>
                <Avatar size="small" icon={<UserOutlined />} style={{ backgroundColor: token.colorPrimary }} />
                <Text>{user?.displayName || user?.username || "-"}</Text>
                <DownOutlined style={{ fontSize: 10 }} />
              </Space>
            </Dropdown>
          </Space>
        </Header>

        <Content style={{ padding: 24, maxWidth: 1400, margin: "0 auto", width: "100%" }}>
          <BreadcrumbBar />
          <Outlet />
        </Content>
        <FloatingFeedback />
        <HermesChat title="AI 问答" bottom={156} />
        <CommandPalette />
      </Layout>
    </Layout>
  );
}
