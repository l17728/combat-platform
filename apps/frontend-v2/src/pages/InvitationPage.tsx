import React, { useState, useEffect, useCallback } from "react";
import { Table, Button, Modal, Form, Input, Select, Space, Popconfirm, message, Tag, Alert } from "antd";
import { PlusOutlined, DeleteOutlined, MailOutlined } from "@ant-design/icons";
import { api } from "../api.js";
import HelpButton from "../components/HelpButton.js";
import HELP from "../help-content.js";

interface Invitation {
  id: string;
  code: string;
  role: string;
  email: string;
  displayName: string;
  usedBy: string | null;
  usedAt: string | null;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
}

const ROLE_LABELS: Record<string, { label: string; color: string }> = {
  admin: { label: "管理员", color: "red" },
  leader: { label: "负责人", color: "orange" },
  normal: { label: "成员", color: "blue" },
};

export default function InvitationPage() {
  const [list, setList] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  const fetchList = useCallback(async (silent?: boolean) => {
    if (!silent) setLoading(true);
    try {
      const data = await api.listInvitations();
      setList(data);
    } catch (e: any) {
      message.error("加载失败: " + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  const handleCreate = async () => {
    try {
      setSubmitting(true);
      const values = await form.validateFields();
      await api.createInvitation(values);
      message.success(`邀请已发送至 ${values.email}`);
      setModalOpen(false);
      form.resetFields();
      fetchList(true);
    } catch (e: any) {
      if (e.errorFields) return;
      message.error(e.message || "创建失败");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteInvitation(id);
      message.success("已删除");
      fetchList(true);
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const copyLink = (code: string) => {
    const base = window.location.origin;
    navigator.clipboard.writeText(`${base}/invite?code=${code}`);
    message.success("链接已复制");
  };

  const columns = [
    {
      title: "邀请码",
      dataIndex: "code",
      key: "code",
      width: 140,
      render: (code: string) => <code style={{ fontSize: 13, letterSpacing: 1 }}>{code}</code>,
    },
    {
      title: "邮箱",
      dataIndex: "email",
      key: "email",
      width: 200,
      ellipsis: true,
    },
    {
      title: "角色",
      dataIndex: "role",
      key: "role",
      width: 100,
      render: (role: string) => {
        const r = ROLE_LABELS[role] || { label: role, color: "default" };
        return <Tag color={r.color}>{r.label}</Tag>;
      },
    },
    {
      title: "状态",
      key: "status",
      width: 100,
      render: (_: unknown, inv: Invitation) => {
        if (inv.usedBy) return <Tag color="green">已使用</Tag>;
        if (new Date(inv.expiresAt) < new Date()) return <Tag color="default">已过期</Tag>;
        return <Tag color="blue">待使用</Tag>;
      },
    },
    {
      title: "创建人",
      dataIndex: "createdBy",
      key: "createdBy",
      width: 100,
    },
    {
      title: "有效期至",
      dataIndex: "expiresAt",
      key: "expiresAt",
      width: 160,
      render: (t: string) => (t ? new Date(t).toLocaleString() : "-"),
    },
    {
      title: "操作",
      key: "ops",
      width: 160,
      render: (_: unknown, inv: Invitation) => (
        <Space size={4}>
          {!inv.usedBy && new Date(inv.expiresAt) >= new Date() && <a onClick={() => copyLink(inv.code)}>复制链接</a>}
          {!inv.usedBy && (
            <Popconfirm title="确认删除此邀请？" onConfirm={() => handleDelete(inv.id)}>
              <a style={{ color: "#ff4d4f" }}>
                <DeleteOutlined /> 删除
              </a>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <h4 style={{ margin: 0 }}>邀请管理</h4>
        <Space>
          <HelpButton title={HELP.invitation.title} content={HELP.invitation.content} />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              form.resetFields();
              setModalOpen(true);
            }}
          >
            发送邀请
          </Button>
        </Space>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="通过邮件邀请成员加入平台，可预设角色（管理员/负责人/成员）。被邀请人通过链接注册后自动获得对应角色。需先在「邮件设置」配置 SMTP。"
      />

      <Table
        rowKey="id"
        dataSource={list}
        columns={columns}
        loading={loading}
        size="middle"
        pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
      />

      <Modal
        title="发送邀请"
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleCreate}
        confirmLoading={submitting}
        destroyOnClose
        width={440}
      >
        <Form form={form} layout="vertical" initialValues={{ role: "normal" }}>
          <Form.Item
            name="email"
            label="邮箱地址"
            rules={[{ required: true, type: "email", message: "请输入有效邮箱" }]}
          >
            <Input prefix={<MailOutlined />} placeholder="user@example.com" />
          </Form.Item>
          <Form.Item name="displayName" label="显示名称（可选）">
            <Input placeholder="邀请对象的姓名" />
          </Form.Item>
          <Form.Item name="role" label="预设角色" rules={[{ required: true }]}>
            <Select
              options={[
                { value: "normal", label: "成员" },
                { value: "leader", label: "负责人" },
                { value: "admin", label: "管理员" },
              ]}
            />
          </Form.Item>
          <Form.Item name="expiresInDays" label="有效期（天）">
            <Input type="number" placeholder="7" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
