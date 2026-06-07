import { useState, useEffect, useCallback } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { Layout, Menu, Select, Space, Typography, theme, Dropdown, Button, Avatar, Tooltip, Alert } from "antd";
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
  StarOutlined,
  KeyOutlined,
  CloudServerOutlined,
} from "@ant-design/icons";
import type { MenuProps } from "antd";
import { useAuth } from "../hooks/useAuth.js";
import FloatingFeedback from "../components/FloatingFeedback.js";
import HermesChat from "../components/HermesChat.js";
import CommandPalette from "../components/CommandPalette.js";
import { useThemeContext } from "../hooks/useTheme.js";
import { resetAllTours } from "../components/ProductTour.js";
import { api } from "../api.js";
import { ChangePasswordModal } from "../components/ChangePasswordModal.js";

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
  if (["/search", "/kg", "/screen", "/documents", "/bug-report", "/manual"].includes(path)) return path;
  if (
    [
      "/import",
      "/email",
      "/digest",
      "/webhooks",
      "/invitations",
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
      "/notifications",
      "/platform",
    ].includes(path)
  )
    return path;
  return "/";
}

const SYSTEM_PATH_PREFIXES = [
  "/import",
  "/email",
  "/digest",
  "/webhooks",
  "/invitations",
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
  "/notifications",
  "/platform",
  "/proposals",
  "/reminders",
];

function isSystemPath(path: string): boolean {
  return SYSTEM_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function getOpenKeysForPath(path: string): string[] {
  if (path.startsWith("/attack") || path.startsWith("/daily-report") || path.startsWith("/related")) return ["attack"];
  if (path === "/people" || path === "/contributions" || path.startsWith("/honor")) return ["people"];
  if (path === "/proposals" || path === "/reminders") return ["system", "review"];
  if (
    [
      "/import",
      "/email",
      "/digest",
      "/webhooks",
      "/invitations",
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
      "/notifications",
      "/platform",
    ].includes(path)
  )
    return ["system"];
  if (["/documents", "/search", "/kg", "/screen", "/bug-report", "/manual"].includes(path)) return ["tools"];
  return [];
}

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  const [pwdOpen, setPwdOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { token } = theme.useToken();
  const { user, logout, isAdmin, isSuperAdmin, isGuest } = useAuth();
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
        { key: "/attack", label: "攻关作战台", icon: <ThunderboltOutlined /> },
        { key: "/daily-report", label: "攻关日报", icon: <FileTextOutlined /> },
      ],
    },
    {
      key: "people",
      icon: <TeamOutlined />,
      label: "人员与荣誉",
      onTitleClick: () => navigate("/people"),
      children: [
        { key: "/people", label: "全员名单", icon: <TeamOutlined /> },
        { key: "/contributions", label: "贡献录入", icon: <StarOutlined /> },
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
        { key: "/screen", label: "运营大屏", icon: <DashboardOutlined /> },
        { key: "/documents", label: "文档中心", icon: <FileTextOutlined /> },
        { key: "/bug-report", label: "问题反馈", icon: <BugOutlined /> },
        { key: "/manual", label: "帮助中心", icon: <QuestionCircleOutlined /> },
      ],
    },
    ...(isAdmin || isGuest
      ? [
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
              ...(isAdmin || isGuest
                ? [{ key: "/llm-settings", label: "LLM 设置", icon: <ThunderboltOutlined /> }]
                : []),
              { key: "/audit", label: "审计日志", icon: <FileSearchOutlined /> },
              { key: "/backup", label: "备份恢复", icon: <DatabaseOutlined /> },
              ...(isAdmin || isGuest ? [{ key: "/merge", label: "人员合并", icon: <MergeOutlined /> }] : []),
              ...(isAdmin || isGuest
                ? [{ key: "/system-upgrade", label: "系统升级", icon: <CloudUploadOutlined /> }]
                : []),
              ...(isAdmin || isGuest
                ? [{ key: "/db-migration", label: "数据库迁移", icon: <DatabaseOutlined /> }]
                : []),
              ...(isAdmin || isGuest
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
              ...(isAdmin || isGuest ? [{ key: "/op-log", label: "操作追踪", icon: <EyeOutlined /> }] : []),
              ...(isAdmin || isGuest ? [{ key: "/webhooks", label: "Webhook 订阅", icon: <ApiOutlined /> }] : []),
              ...(isAdmin || isGuest ? [{ key: "/invitations", label: "邀请管理", icon: <TeamOutlined /> }] : []),
              ...(isAdmin || isGuest ? [{ key: "/users", label: "用户管理", icon: <UserOutlined /> }] : []),
              ...(isSuperAdmin || isGuest
                ? [{ key: "/platform", label: "平台管理", icon: <CloudServerOutlined /> }]
                : []),
            ],
          },
        ]
      : []),
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
              会战管理
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
                  ...(isAdmin || isGuest ? [{ key: "/users", label: "用户管理", icon: <UserOutlined /> }] : []),
                  ...(!isGuest ? [{ key: "change-password", label: "修改密码", icon: <KeyOutlined /> }] : []),
                  { type: "divider" },
                  { key: "replay-tour", label: "重播引导", icon: <QuestionCircleOutlined /> },
                  { key: "logout", label: "退出登录", icon: <LogoutOutlined />, danger: true },
                ],
                onClick: ({ key }) => {
                  if (key === "logout") {
                    logout();
                    navigate("/login");
                  } else if (key === "change-password") {
                    setPwdOpen(true);
                  } else if (key === "replay-tour") {
                    resetAllTours();
                    api
                      .resetTours()
                      .then(() => window.location.reload())
                      .catch(() => window.location.reload());
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

        {isGuest && (
          <div
            style={{
              padding: "8px 24px",
              background: "#fffbe6",
              borderBottom: "1px solid #ffe58f",
              textAlign: "center",
              fontSize: 14,
              color: "#ad6800",
            }}
          >
            🛡️ 游客参观模式 — 可查看所有功能，但无法修改任何数据
          </div>
        )}

        <Content style={{ padding: 24, maxWidth: 1400, margin: "0 auto", width: "100%" }}>
          <BreadcrumbBar />
          {isGuest && isSystemPath(location.pathname) && (
            <Alert
              type="info"
              showIcon
              message="游客参观模式 — 可查看所有功能，但无法修改任何数据"
              style={{ marginBottom: 16 }}
              banner
            />
          )}
          <Outlet />
        </Content>
        <FloatingFeedback />
        <HermesChat title="AI 问答" bottom={156} />
        <CommandPalette />
        <ChangePasswordModal open={pwdOpen} onClose={() => setPwdOpen(false)} />
      </Layout>
    </Layout>
  );
}
