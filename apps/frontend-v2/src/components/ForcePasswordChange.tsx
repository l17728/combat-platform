import { useState } from "react";
import { Modal, Form, Input, Button, Alert, Typography, message } from "antd";
import { LockOutlined } from "@ant-design/icons";
import { api } from "../api.js";
import { useAuth } from "../hooks/useAuth.js";

const { Title } = Typography;

// P1 强制改密:admin/admin123 默认密未改前,全局 Modal 锁住所有业务流。
// 关闭按钮被禁用、maskClosable=false、esc 不能关 —— 用户必须改完才能继续。
export function ForcePasswordChange() {
  const { passwordMustChange, clearPasswordMustChange, logout } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  if (!passwordMustChange) return null;

  const handleSubmit = async (values: { oldPassword: string; newPassword: string; confirm: string }) => {
    if (values.newPassword !== values.confirm) {
      message.error("两次输入的新密码不一致");
      return;
    }
    if (values.newPassword === "admin123") {
      message.error("新密码不能与默认密码相同");
      return;
    }
    setSubmitting(true);
    try {
      await api.changePassword(values.oldPassword, values.newPassword);
      message.success("密码已修改,请重新登录");
      clearPasswordMustChange();
      logout();
      window.location.href = "/login";
    } catch (e) {
      message.error((e instanceof Error ? e.message : String(e)) || "改密失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={true}
      closable={false}
      maskClosable={false}
      keyboard={false}
      footer={null}
      width={440}
      destroyOnClose
      title={
        <Title level={5} style={{ margin: 0 }}>
          请修改默认密码
        </Title>
      }
    >
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
        message="为安全起见,首次使用必须修改默认管理员密码"
        description="修改前无法访问任何业务功能。修改成功后将自动退出,请用新密码重新登录。"
      />
      <Form form={form} layout="vertical" onFinish={handleSubmit} size="middle">
        <Form.Item name="oldPassword" label="当前密码" rules={[{ required: true, message: "请输入当前密码" }]}>
          <Input.Password prefix={<LockOutlined />} placeholder="admin123" autoFocus />
        </Form.Item>
        <Form.Item
          name="newPassword"
          label="新密码"
          rules={[
            { required: true, message: "请输入新密码" },
            { min: 8, message: "新密码至少 8 位" },
          ]}
        >
          <Input.Password prefix={<LockOutlined />} placeholder="至少 8 位" />
        </Form.Item>
        <Form.Item
          name="confirm"
          label="再次输入新密码"
          dependencies={["newPassword"]}
          rules={[
            { required: true, message: "请再次输入新密码" },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue("newPassword") === value) return Promise.resolve();
                return Promise.reject(new Error("两次输入不一致"));
              },
            }),
          ]}
        >
          <Input.Password prefix={<LockOutlined />} placeholder="确认新密码" />
        </Form.Item>
        <Form.Item style={{ marginBottom: 0 }}>
          <Button type="primary" htmlType="submit" loading={submitting} block>
            修改密码
          </Button>
        </Form.Item>
      </Form>
    </Modal>
  );
}
