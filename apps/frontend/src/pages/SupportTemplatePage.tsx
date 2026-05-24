import { useEffect, useState, useCallback } from "react";
import { Button, List, Modal, Form, Input, Typography, Space, message, Popconfirm } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";

interface SupportTemplate {
  id: string;
  name: string;
  description: string;
  usageCount: number;
  createdAt: string;
}

export function SupportTemplatePage() {
  const [templates, setTemplates] = useState<SupportTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/support-templates");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTemplates(data);
    } catch (e) {
      message.error("加载模板失败：" + String((e as Error).message));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const handleCreate = async (values: { name: string; description?: string }) => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/support-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: values.name, description: values.description ?? "" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      message.success("模板创建成功");
      setModalOpen(false);
      form.resetFields();
      fetchTemplates();
    } catch (e) {
      message.error("创建失败：" + String((e as Error).message));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/support-templates/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
      message.success("模板已删除");
      fetchTemplates();
    } catch (e) {
      message.error("删除失败：" + String((e as Error).message));
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 800 }}>
      <Typography.Title level={3}>支援模板管理</Typography.Title>
      <div style={{ marginBottom: 16 }}>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          aria-label="create-template"
          onClick={() => { form.resetFields(); setModalOpen(true); }}
        >
          新建模板
        </Button>
      </div>

      <List
        loading={loading}
        dataSource={templates}
        rowKey="id"
        bordered
        renderItem={(tpl) => (
          <List.Item
            actions={[
              <Popconfirm
                key="delete"
                title="确认删除该模板？"
                okText="删除"
                cancelText="取消"
                onConfirm={() => handleDelete(tpl.id)}
              >
                <Button
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  aria-label={`delete-template-${tpl.id}`}
                >
                  删除
                </Button>
              </Popconfirm>,
            ]}
          >
            <List.Item.Meta
              title={
                <Space>
                  <Typography.Text strong>{tpl.name}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    使用次数: {tpl.usageCount}
                  </Typography.Text>
                </Space>
              }
              description={tpl.description || "暂无描述"}
            />
          </List.Item>
        )}
      />

      <Modal
        title="新建支援模板"
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        footer={null}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          <Form.Item
            name="name"
            label="模板名称"
            rules={[{ required: true, message: "模板名称必填" }]}
          >
            <Input aria-label="template-name" placeholder="请输入模板名称" />
          </Form.Item>
          <Form.Item name="description" label="描述（可选）">
            <Input.TextArea
              aria-label="template-desc"
              rows={3}
              placeholder="请输入模板描述..."
            />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0, textAlign: "right" }}>
            <Space>
              <Button onClick={() => setModalOpen(false)}>取消</Button>
              <Button type="primary" htmlType="submit" loading={submitting} aria-label="submit-template">
                提交
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
