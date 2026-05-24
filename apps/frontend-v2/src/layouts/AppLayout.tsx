import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Select, Space, Typography, theme } from 'antd';
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
} from '@ant-design/icons';
import type { MenuProps } from 'antd';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

const ROLES = [
  { value: 'normal', label: '普通成员' },
  { value: 'leader', label: 'Leader' },
  { value: 'admin', label: '管理员' },
];

const menuItems: MenuProps['items'] = [
  {
    key: '/',
    icon: <DashboardOutlined />,
    label: '作战态势',
  },
  {
    key: '/attack',
    icon: <ThunderboltOutlined />,
    label: '攻关管理',
    children: [
      { key: '/attack', label: '攻关作战台' },
    ],
  },
  {
    key: '/people-group',
    icon: <TeamOutlined />,
    label: '人员与荣誉',
    children: [
      { key: '/people', label: '全员名单' },
      { key: '/contributions', label: '贡献录入' },
      { key: '/honor', label: '荣誉殿堂' },
    ],
  },
  {
    key: '/help',
    icon: <MailOutlined />,
    label: '求助中心',
  },
  {
    key: '/system',
    icon: <ToolOutlined />,
    label: '系统管理',
    children: [
      { key: '/import', label: '数据导入/导出', icon: <ImportOutlined /> },
      { key: '/email', label: '邮件设置', icon: <SettingOutlined /> },
      { key: '/audit', label: '审计日志', icon: <FileSearchOutlined /> },
    ],
  },
];

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { token } = theme.useToken();

  const currentRole =
    (typeof localStorage !== 'undefined' && localStorage.getItem('combat-role')) || 'normal';

  const selectedKeys = [location.pathname];
  const openKeys = collapsed
    ? []
    : (() => {
        const path = location.pathname;
        if (path.startsWith('/attack')) return ['/attack'];
        if (path === '/people' || path === '/contributions' || path.startsWith('/honor'))
          return ['/people-group'];
        if (path === '/help') return [];
        if (['/import', '/email', '/audit'].includes(path)) return ['/system'];
        return [];
      })();

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        trigger={null}
        width={200}
        collapsedWidth={64}
        style={{
          borderRight: `1px solid ${token.colorBorderSecondary}`,
          overflow: 'auto',
          height: '100vh',
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
        }}
      >
        <div
          style={{
            height: 48,
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
            padding: collapsed ? 0 : '0 20px',
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          {collapsed ? (
            <ThunderboltOutlined style={{ fontSize: 20, color: token.colorPrimary }} />
          ) : (
            <Text
              strong
              style={{ fontSize: 16, color: token.colorPrimary, whiteSpace: 'nowrap' }}
            >
              作战平台
            </Text>
          )}
        </div>
        <Menu
          mode="inline"
          selectedKeys={selectedKeys}
          openKeys={openKeys}
          onClick={({ key }) => {
            if (key.startsWith('/')) navigate(key);
          }}
          items={menuItems}
          style={{ borderRight: 'none' }}
        />
      </Sider>

      <Layout style={{ marginLeft: collapsed ? 64 : 200, transition: 'margin-left 0.2s' }}>
        <Header
          style={{
            height: 48,
            padding: '0 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            background: '#fff',
            position: 'sticky',
            top: 0,
            zIndex: 10,
          }}
        >
          <Space>
            <span
              onClick={() => setCollapsed(!collapsed)}
              style={{ cursor: 'pointer', fontSize: 18, lineHeight: '48px' }}
            >
              {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            </span>
          </Space>
          <Select
            value={currentRole}
            onChange={(v) => {
              localStorage.setItem('combat-role', v);
              window.location.reload();
            }}
            options={ROLES}
            size="small"
            style={{ width: 120 }}
          />
        </Header>

        <Content style={{ padding: 24, maxWidth: 1400, margin: '0 auto', width: '100%' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
