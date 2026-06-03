import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Card, Statistic, Row, Col, Table, Tag, Button, Typography, Space, Spin, Descriptions, Progress } from "antd";
import { ArrowLeftOutlined, TeamOutlined, DatabaseOutlined, FileTextOutlined, AuditOutlined } from "@ant-design/icons";
import { api, type Tenant } from "../api.js";
import { handleApiError } from "../utils/handleApiError.js";

const { Title, Text } = Typography;

const PLAN_LABEL: Record<string, string> = { free: "免费版", pro: "专业版", enterprise: "企业版" };
const STATUS_COLOR: Record<string, string> = { active: "green", suspended: "red" };

export default function TenantDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [usage, setUsage] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([api.getTenant(id), api.getTenantUsers(id), api.getTenantUsage(id)])
      .then(([t, u, us]) => {
        setTenant(t);
        setUsers(u);
        setUsage(us);
      })
      .catch(handleApiError)
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <Spin style={{ display: "block", margin: "40vh auto" }} />;
  if (!tenant) return <Text>租户不存在</Text>;

  const userPercent = usage ? Math.round((usage.users / usage.maxUsers) * 100) : 0;

  const userColumns = [
    { title: "用户名", dataIndex: "username", key: "username" },
    { title: "显示名", dataIndex: "display_name", key: "display_name" },
    {
      title: "角色",
      dataIndex: "role",
      key: "role",
      render: (r: string) => {
        const color = r === "admin" ? "red" : r === "leader" ? "blue" : "default";
        return <Tag color={color}>{r}</Tag>;
      },
    },
    {
      title: "创建时间",
      dataIndex: "created_at",
      key: "created_at",
      render: (t: string) => new Date(t).toLocaleString(),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate("/platform")}>
          返回
        </Button>
      </Space>
      <Title level={3}>{tenant.name}</Title>
      <Descriptions bordered size="small" column={3} style={{ marginBottom: 24 }}>
        <Descriptions.Item label="标识">{tenant.slug}</Descriptions.Item>
        <Descriptions.Item label="计划">{PLAN_LABEL[tenant.plan] || tenant.plan}</Descriptions.Item>
        <Descriptions.Item label="状态">
          <Tag color={STATUS_COLOR[tenant.status]}>{tenant.status}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="创建时间">{new Date(tenant.created_at).toLocaleString()}</Descriptions.Item>
        <Descriptions.Item label="更新时间">{new Date(tenant.updated_at).toLocaleString()}</Descriptions.Item>
        <Descriptions.Item label="ID">
          <Text copyable style={{ fontSize: 11 }}>
            {tenant.id}
          </Text>
        </Descriptions.Item>
      </Descriptions>

      {usage && (
        <>
          <Title level={4}>资源用量</Title>
          <Row gutter={16} style={{ marginBottom: 24 }}>
            <Col span={6}>
              <Card>
                <Statistic title="用户" value={usage.users} suffix={`/ ${usage.maxUsers}`} prefix={<TeamOutlined />} />
                <Progress percent={userPercent} size="small" status={userPercent > 90 ? "exception" : "active"} />
              </Card>
            </Col>
            <Col span={6}>
              <Card>
                <Statistic title="节点" value={usage.nodes} prefix={<DatabaseOutlined />} />
              </Card>
            </Col>
            <Col span={6}>
              <Card>
                <Statistic title="知识库文章" value={usage.wikiArticles} prefix={<FileTextOutlined />} />
              </Card>
            </Col>
            <Col span={6}>
              <Card>
                <Statistic title="审计日志" value={usage.auditLogs} prefix={<AuditOutlined />} />
              </Card>
            </Col>
          </Row>
        </>
      )}

      <Title level={4}>用户列表 ({users.length})</Title>
      <Table dataSource={users} columns={userColumns} rowKey="id" pagination={{ pageSize: 20 }} size="small" />
    </div>
  );
}
