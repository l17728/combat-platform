import React, { useState, useEffect, useCallback } from "react";
import { Table, Button, Modal, Form, Input, Select, Switch, Space, Popconfirm, message, Tag, Alert } from "antd";
import { PlusOutlined, SendOutlined, DeleteOutlined, EditOutlined } from "@ant-design/icons";
import { api } from "../api.js";
import HelpButton from "../components/HelpButton.js";
import HELP from "../help-content.js";

interface WebhookSub {
  id: string;
  url: string;
  secret: string;
  events: string[];
  enabled: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

const EVENT_LABELS: Record<string, string> = {
  "node.created": "节点创建",
  "node.updated": "节点更新",
  "node.deleted": "节点删除",
  "node.transition": "状态流转",
  "progress.added": "进展追加",
  "help_request.created": "求助创建",
  "bug_report.created": "问题反馈创建",
  "reminder.sent": "提醒发送",
  "escalation.triggered": "升级触发",
  "user.created": "用户创建",
  "system.upgrade": "系统升级",
};

export default function WebhookSettings() {
  const [subs, setSubs] = useState<WebhookSub[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  const [form] = Form.useForm();

  const fetchSubs = useCallback(async (silent?: boolean) => {
    if (!silent) setLoading(true);
    try {
      const data = await api.listWebhooks();
      setSubs(data);
    } catch (e: any) {
      message.error("加载失败: " + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchEvents = useCallback(async () => {
    try {
      const data = await api.getWebhookEvents();
      setEvents(data);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetchSubs();
    fetchEvents();
  }, [fetchSubs, fetchEvents]);

  const handleCreate = () => {
    setEditingId(null);
    form.resetFields();
    setModalOpen(true);
  };

  const handleEdit = (sub: WebhookSub) => {
    setEditingId(sub.id);
    form.setFieldsValue({ url: sub.url, events: sub.events });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    const values = { ...form.getFieldsValue() };
    const url = values.url?.trim();
    if (!url) {
      form.validateFields(["url"]).catch(() => {});
      return;
    }
    try {
      if (editingId) {
        await api.updateWebhook(editingId, values);
        message.success("更新成功");
      } else {
        await api.createWebhook(values.url, values.events);
        message.success("创建成功");
      }
      setModalOpen(false);
      form.resetFields();
      fetchSubs(true);
    } catch (e) {
      message.error((e as Error).message || "操作失败");
    }
  };

  const handleToggle = async (sub: WebhookSub, enabled: boolean) => {
    try {
      await api.updateWebhook(sub.id, { enabled });
      fetchSubs(true);
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteWebhook(id);
      message.success("已删除");
      fetchSubs(true);
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const handleTest = async (sub: WebhookSub) => {
    try {
      const res = await api.testWebhook(sub.id);
      message.success(res.message || "测试已发送");
    } catch (e: any) {
      message.error("测试失败: " + e.message);
    }
  };

  const columns = [
    {
      title: "URL",
      dataIndex: "url",
      key: "url",
      ellipsis: true,
      render: (url: string) => <code style={{ fontSize: 13 }}>{url}</code>,
    },
    {
      title: "订阅事件",
      dataIndex: "events",
      key: "events",
      width: 280,
      render: (evts: string[]) => (
        <Space wrap size={4}>
          {evts.map((e) => (
            <Tag key={e} color="blue">
              {EVENT_LABELS[e] || e}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: "状态",
      dataIndex: "enabled",
      key: "enabled",
      width: 80,
      render: (en: boolean, sub: WebhookSub) => (
        <Switch size="small" checked={en} onChange={(v) => handleToggle(sub, v)} />
      ),
    },
    {
      title: "创建人",
      dataIndex: "createdBy",
      key: "createdBy",
      width: 100,
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 160,
      render: (t: string) => (t ? new Date(t).toLocaleString() : "-"),
    },
    {
      title: "操作",
      key: "ops",
      width: 180,
      render: (_: unknown, sub: WebhookSub) => (
        <Space size={4}>
          <a onClick={() => handleEdit(sub)}>
            <EditOutlined /> 编辑
          </a>
          <a onClick={() => handleTest(sub)}>
            <SendOutlined /> 测试
          </a>
          <Popconfirm title="确认删除此订阅？" onConfirm={() => handleDelete(sub.id)}>
            <a style={{ color: "#ff4d4f" }}>
              <DeleteOutlined /> 删除
            </a>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <h4 style={{ margin: 0 }}>Webhook 订阅</h4>
        <Space>
          <HelpButton title={HELP.webhookSettings.title} content={HELP.webhookSettings.content} />
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            新建订阅
          </Button>
        </Space>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Webhook 事件以 HTTP POST 推送到指定 URL，请求头包含 X-Webhook-Secret（用于验签）和 X-Webhook-Event（事件类型）。仅管理员可管理订阅。"
      />

      <Table
        rowKey="id"
        dataSource={subs}
        columns={columns}
        loading={loading}
        size="middle"
        pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
      />

      <Modal
        title={editingId ? "编辑订阅" : "新建订阅"}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSubmit}
        forceRender
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="url"
            label="回调 URL"
            rules={[
              { required: true, message: "必填" },
              { type: "url", message: "请输入有效 URL" },
            ]}
          >
            <Input placeholder="https://example.com/webhook" />
          </Form.Item>
          <Form.Item name="events" label="订阅事件" rules={[{ required: true, message: "至少选一个事件" }]}>
            <Select
              mode="multiple"
              placeholder="选择要订阅的事件"
              options={events.map((e) => ({ value: e, label: EVENT_LABELS[e] || e }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
