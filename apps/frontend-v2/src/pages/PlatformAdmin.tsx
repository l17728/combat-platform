import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Table,
  Button,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Tag,
  Space,
  message,
  Card,
  Statistic,
  Row,
  Col,
  Popconfirm,
} from "antd";
import {
  PlusOutlined,
  StopOutlined,
  CheckCircleOutlined,
  TeamOutlined,
  DatabaseOutlined,
  CloudServerOutlined,
} from "@ant-design/icons";
import { api, type Tenant } from "../api.js";
import { handleApiError } from "../utils/handleApiError.js";

const PLAN_OPTIONS = [
  { label: "免费版", value: "free" },
  { label: "专业版", value: "pro" },
  { label: "企业版", value: "enterprise" },
];

const STATUS_COLOR: Record<string, string> = { active: "green", suspended: "red" };
const STATUS_LABEL: Record<string, string> = { active: "活跃", suspended: "已暂停" };

export default function PlatformAdmin() {
  const navigate = useNavigate();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<{ tenantCount: number; userCount: number; nodeCount: number } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [editOpen, setEditOpen] = useState(false);
  const [editForm] = Form.useForm();
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [t, s] = await Promise.all([api.listTenants(), api.getPlatformStats()]);
      setTenants(t);
      setStats(s);
    } catch (e) {
      handleApiError(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCreate = async () => {
    const values = createForm.getFieldsValue();
    if (!values.name || !values.slug) {
      createForm.validateFields(["name", "slug"]).catch(() => {});
      return;
    }
    try {
      await api.createTenant(values);
      message.success("租户创建成功");
      setCreateOpen(false);
      createForm.resetFields();
      fetchData();
    } catch (e) {
      handleApiError(e);
    }
  };

  const handleEdit = async () => {
    if (!editingTenant) return;
    const values = editForm.getFieldsValue();
    try {
      await api.updateTenant(editingTenant.id, values);
      message.success("更新成功");
      setEditOpen(false);
      setEditingTenant(null);
      fetchData();
    } catch (e) {
      handleApiError(e);
    }
  };

  const openEdit = (tenant: Tenant) => {
    setEditingTenant(tenant);
    editForm.setFieldsValue({
      name: tenant.name,
      plan: tenant.plan,
      maxUsers: tenant.max_users,
    });
    setEditOpen(true);
  };

  const handleSuspend = async (id: string) => {
    try {
      await api.suspendTenant(id);
      message.success("已暂停");
      fetchData();
    } catch (e) {
      handleApiError(e);
    }
  };

  const handleRestore = async (id: string) => {
    try {
      await api.restoreTenant(id);
      message.success("已恢复");
      fetchData();
    } catch (e) {
      handleApiError(e);
    }
  };

  const columns = [
    { title: "名称", dataIndex: "name", key: "name" },
    { title: "标识", dataIndex: "slug", key: "slug", render: (s: string) => <Tag>{s}</Tag> },
    {
      title: "计划",
      dataIndex: "plan",
      key: "plan",
      render: (p: string) => PLAN_OPTIONS.find((o) => o.value === p)?.label || p,
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      render: (s: string) => <Tag color={STATUS_COLOR[s]}>{STATUS_LABEL[s] || s}</Tag>,
    },
    { title: "最大用户数", dataIndex: "max_users", key: "max_users" },
    {
      title: "创建时间",
      dataIndex: "created_at",
      key: "created_at",
      render: (t: string) => new Date(t).toLocaleString(),
    },
    {
      title: "操作",
      key: "actions",
      render: (_: unknown, record: Tenant) => (
        <Space>
          <Button size="small" onClick={() => navigate(`/platform/tenants/${record.id}`)}>
            详情
          </Button>
          <Button size="small" onClick={() => openEdit(record)}>
            编辑
          </Button>
          {record.status === "active" && record.id !== "default" ? (
            <Popconfirm title="确认暂停此租户？" onConfirm={() => handleSuspend(record.id)}>
              <Button size="small" danger icon={<StopOutlined />}>
                暂停
              </Button>
            </Popconfirm>
          ) : record.status === "suspended" ? (
            <Button size="small" type="primary" icon={<CheckCircleOutlined />} onClick={() => handleRestore(record.id)}>
              恢复
            </Button>
          ) : null}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <h2>
        <CloudServerOutlined /> 平台管理
      </h2>
      {stats && (
        <Row gutter={16} style={{ marginBottom: 24 }}>
          <Col span={8}>
            <Card>
              <Statistic title="租户数" value={stats.tenantCount} prefix={<CloudServerOutlined />} />
            </Card>
          </Col>
          <Col span={8}>
            <Card>
              <Statistic title="用户数" value={stats.userCount} prefix={<TeamOutlined />} />
            </Card>
          </Col>
          <Col span={8}>
            <Card>
              <Statistic title="节点数" value={stats.nodeCount} prefix={<DatabaseOutlined />} />
            </Card>
          </Col>
        </Row>
      )}
      <div style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
          创建租户
        </Button>
      </div>
      <Table dataSource={tenants} columns={columns} rowKey="id" loading={loading} pagination={{ pageSize: 20 }} />

      <Modal
        title="创建租户"
        open={createOpen}
        onCancel={() => {
          setCreateOpen(false);
          createForm.resetFields();
        }}
        onOk={handleCreate}
        okText="创建"
      >
        <Form form={createForm} layout="vertical">
          <Form.Item name="name" label="租户名称" rules={[{ required: true, message: "请输入名称" }]}>
            <Input placeholder="例: XX团队" />
          </Form.Item>
          <Form.Item name="slug" label="标识 (slug)" rules={[{ required: true, message: "请输入标识" }]}>
            <Input placeholder="例: xx-team（小写字母数字和连字符）" />
          </Form.Item>
          <Form.Item name="plan" label="计划" initialValue="free">
            <Select options={PLAN_OPTIONS} />
          </Form.Item>
          <Form.Item name="maxUsers" label="最大用户数" initialValue={50}>
            <InputNumber min={1} max={10000} style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`编辑租户: ${editingTenant?.name ?? ""}`}
        open={editOpen}
        onCancel={() => {
          setEditOpen(false);
          setEditingTenant(null);
        }}
        onOk={handleEdit}
        okText="保存"
      >
        <Form form={editForm} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="plan" label="计划">
            <Select options={PLAN_OPTIONS} />
          </Form.Item>
          <Form.Item name="maxUsers" label="最大用户数">
            <InputNumber min={1} max={10000} style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
