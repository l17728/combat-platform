import { useState } from "react";
import { Form, Input, Button, Card, Typography, message, Divider } from "antd";
import { UserOutlined, LockOutlined, EyeOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth.js";
import { handleApiError } from "../utils/handleApiError.js";

const { Title, Text } = Typography;

export default function LoginPage() {
  const { login, guestLogin } = useAuth();
  const [loading, setLoading] = useState(false);
  const [guestLoading, setGuestLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (values: { username: string; password: string }) => {
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

  const handleGuest = async () => {
    setGuestLoading(true);
    try {
      await guestLogin();
      message.success("欢迎体验");
      navigate("/", { replace: true });
    } catch (e) {
      handleApiError(e, "游客登录失败");
    } finally {
      setGuestLoading(false);
    }
  };

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
      <Card style={{ width: 400, boxShadow: "0 8px 24px rgba(0,0,0,0.15)" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <Title level={3} style={{ margin: 0 }}>
            作战平台
          </Title>
          <Text type="secondary">请登录以继续</Text>
        </div>

        <Form onFinish={handleSubmit} layout="vertical" size="large">
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

        <Divider style={{ margin: "16px 0", color: "#999", fontSize: 12 }}>或</Divider>

        <Button
          icon={<EyeOutlined />}
          onClick={handleGuest}
          loading={guestLoading}
          block
          size="large"
          style={{ marginBottom: 12 }}
        >
          游客体验
        </Button>
        <div style={{ textAlign: "center" }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            游客可浏览全部数据，新建和编辑自己的攻关单
          </Text>
        </div>

        <Divider style={{ margin: "16px 0 8px" }} />
        <div style={{ textAlign: "center" }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            默认管理员: admin / admin123
          </Text>
        </div>
      </Card>
    </div>
  );
}
