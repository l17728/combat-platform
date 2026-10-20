import { useState } from "react";
import { Form, Input, Button, Card, Typography, message, Space, Tabs, Select } from "antd";
import { UserOutlined, LockOutlined, TeamOutlined, GlobalOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth.js";
import { AUTH_CONSTRAINTS } from "@combat/shared";
import { handleApiError } from "../utils/handleApiError.js";
import { api, setAuthToken } from "../api.js";

const { Title, Text } = Typography;

export default function LoginPage() {
  const { login } = useAuth();
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("login");
  const navigate = useNavigate();

  const handleLogin = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      const result = await login(values.username, values.password);
      if (result?.passwordMustChange) {
        message.warning("请先修改默认密码后再使用");
      } else {
        message.success("登录成功");
      }
      navigate("/", { replace: true });
    } catch (e) {
      handleApiError(e, "登录失败");
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (values: {
    username: string;
    password: string;
    displayName?: string;
    tenantName?: string;
    tenantSlug?: string;
    inviteCode?: string;
  }) => {
    setLoading(true);
    try {
      const result = await api.register({
        username: values.username,
        password: values.password,
        displayName: values.displayName,
        tenantName: values.tenantName || undefined,
        tenantSlug: values.tenantSlug || undefined,
        inviteCode: values.inviteCode || undefined,
      });
      setAuthToken(result.token);
      window.location.href = "/";
    } catch (e) {
      handleApiError(e, "注册失败");
      setLoading(false);
    }
  };

  const handleGuestAccess = async () => {
    setLoading(true);
    try {
      const result = await api.guestAccess();
      setAuthToken(result.token, true);
      window.location.href = "/";
    } catch (e) {
      handleApiError(e, "体验入口暂时不可用");
      setLoading(false);
    }
  };

  const tabItems = [
    {
      key: "login",
      label: "登录",
      children: (
        <Form onFinish={handleLogin} layout="vertical" size="large">
          <Form.Item name="username" rules={[{ required: true, message: "请输入用户名" }]}>
            <Input prefix={<UserOutlined />} placeholder="用户名" />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: "请输入密码" }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="密码" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 8 }}>
            <Button type="primary" htmlType="submit" loading={loading} block>
              登录
            </Button>
          </Form.Item>
        </Form>
      ),
    },
    {
      key: "register",
      label: "注册",
      children: (
        <Form onFinish={handleRegister} layout="vertical" size="large">
          <Form.Item name="username" rules={[{ required: true, message: "请输入用户名" }]}>
            <Input prefix={<UserOutlined />} placeholder="用户名" />
          </Form.Item>
          <Form.Item
            name="password"
            rules={[
              { required: true, message: "请输入密码" },
              {
                min: AUTH_CONSTRAINTS.PASSWORD_MIN_LENGTH,
                message: `至少${AUTH_CONSTRAINTS.PASSWORD_MIN_LENGTH}个字符`,
              },
            ]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="密码" />
          </Form.Item>
          <Form.Item name="displayName">
            <Input placeholder="显示名（可选）" />
          </Form.Item>
          <div style={{ borderTop: "1px solid #f0f0f0", paddingTop: 12, marginBottom: 12 }}>
            <Text strong style={{ display: "block", marginBottom: 8 }}>
              <TeamOutlined /> 创建新团队
            </Text>
            <Form.Item name="tenantName">
              <Input placeholder="团队名称（如: XX团队）" />
            </Form.Item>
            <Form.Item name="tenantSlug">
              <Input placeholder="团队标识（如: xx-team）" />
            </Form.Item>
          </div>
          <div style={{ borderTop: "1px solid #f0f0f0", paddingTop: 12, marginBottom: 12 }}>
            <Text strong style={{ display: "block", marginBottom: 8 }}>
              加入已有团队
            </Text>
            <Form.Item name="inviteCode">
              <Input placeholder="邀请码（可选）" />
            </Form.Item>
          </div>
          <Form.Item style={{ marginBottom: 8 }}>
            <Button type="primary" htmlType="submit" loading={loading} block>
              注册
            </Button>
          </Form.Item>
        </Form>
      ),
    },
  ];

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
      }}
    >
      <Card style={{ width: 420, boxShadow: "0 8px 24px rgba(0,0,0,0.15)" }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <Title level={3} style={{ margin: 0 }}>
            会战管理
          </Title>
          <Text type="secondary">请登录以继续</Text>
        </div>

        <Tabs activeKey={tab} onChange={setTab} items={tabItems} centered size="small" />

        <div style={{ textAlign: "center", marginTop: 16, borderTop: "1px solid #f0f0f0", paddingTop: 12 }}>
          <Button icon={<GlobalOutlined />} onClick={handleGuestAccess} loading={loading} type="link">
            免登录体验
          </Button>
        </div>
      </Card>
    </div>
  );
}
