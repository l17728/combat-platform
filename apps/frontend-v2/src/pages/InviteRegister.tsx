import React, { useState, useEffect } from "react";
import { Card, Form, Input, Button, Alert, Spin, Typography, Tag } from "antd";
import { UserOutlined, LockOutlined } from "@ant-design/icons";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api.js";

const ROLE_LABELS: Record<string, string> = { admin: "管理员", leader: "负责人", normal: "成员" };

export default function InviteRegister() {
  const [params] = useSearchParams();
  const code = params.get("code") || "";
  const [inviteInfo, setInviteInfo] = useState<{ role: string; email: string; displayName: string } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!code) {
      setError("缺少邀请码");
      setLoading(false);
      return;
    }
    api
      .checkInvite(code)
      .then((data) => {
        setInviteInfo(data);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message || "邀请码无效");
        setLoading(false);
      });
  }, [code]);

  const handleRegister = async (values: { username: string; password: string; displayName: string }) => {
    try {
      setSubmitting(true);
      await api.register({ ...values, inviteCode: code });
      setSuccess(true);
      setTimeout(() => navigate("/login"), 2000);
    } catch (e: any) {
      setError(e.message || "注册失败");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading)
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}>
        <Spin size="large" />
      </div>
    );

  if (success) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
          background: "#f0f2f5",
        }}
      >
        <Card style={{ width: 400, textAlign: "center" }}>
          <Alert type="success" message="注册成功！" description="正在跳转到登录页面..." showIcon />
        </Card>
      </div>
    );
  }

  if (error && !inviteInfo) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
          background: "#f0f2f5",
        }}
      >
        <Card style={{ width: 400, textAlign: "center" }}>
          <Alert type="error" message="邀请无效" description={error} showIcon />
          <Button type="link" onClick={() => navigate("/login")}>
            返回登录
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        minHeight: "100vh",
        background: "linear-gradient(135deg, #1890ff, #722ed1)",
      }}
    >
      <Card
        style={{ width: 420 }}
        title={
          <div style={{ textAlign: "center" }}>
            <Typography.Title level={4} style={{ margin: 0 }}>
              加入作战管理平台
            </Typography.Title>
            <div style={{ marginTop: 8 }}>
              <Tag color="blue">{ROLE_LABELS[inviteInfo?.role || "normal"] || "成员"}</Tag>
              {inviteInfo?.email && <span style={{ color: "#666", marginLeft: 8 }}>{inviteInfo.email}</span>}
            </div>
          </div>
        }
      >
        <Form
          onFinish={handleRegister}
          layout="vertical"
          initialValues={{ displayName: inviteInfo?.displayName || "" }}
        >
          <Form.Item
            name="username"
            label="用户名"
            rules={[{ required: true, min: 2, max: 32, message: "2-32 个字符" }]}
          >
            <Input prefix={<UserOutlined />} placeholder="设置用户名" />
          </Form.Item>
          <Form.Item name="displayName" label="显示名称">
            <Input placeholder="您的姓名" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, min: 6, message: "至少 6 个字符" }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="设置密码" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={submitting} block>
              注册并加入
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
