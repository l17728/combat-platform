import { useState } from "react";
import { Modal, Form, Input, Button, Typography, message } from "antd";
import { LockOutlined } from "@ant-design/icons";
import { api } from "../api.js";

const { Title } = Typography;

export function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  const handleSubmit = async (values: { oldPassword: string; newPassword: string; confirm: string }) => {
    if (values.newPassword !== values.confirm) {
      message.error("两次输入的新密码不一致");
      return;
    }
    setSubmitting(true);
    try {
      await api.changePassword(values.oldPassword, values.newPassword);
      message.success("密码已修改,下次登录请使用新密码");
      form.resetFields();
      onClose();
    } catch (e) {
      message.error((e instanceof Error ? e.message : String(e)) || "改密失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={() => {
        form.resetFields();
        onClose();
      }}
      footer={null}
      width={440}
      destroyOnClose
      title={
        <Title level={5} style={{ margin: 0 }}>
          修改密码
        </Title>
      }
    >
      <Form form={form} layout="vertical" onFinish={handleSubmit} size="middle">
        <Form.Item name="oldPassword" label="当前密码" rules={[{ required: true, message: "请输入当前密码" }]}>
          <Input.Password prefix={<LockOutlined />} autoFocus />
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
          <Input.Password prefix={<LockOutlined />} />
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
