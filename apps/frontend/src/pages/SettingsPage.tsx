import { useEffect, useState } from "react";
import { Card, Button, message, Typography, Space, Row, Col, List, Input } from "antd";
import { Link } from "react-router-dom";

const { Title, Text } = Typography;

const QUICK_LINKS = [
  { label: "Schema 管理", to: "/schema-wizard", desc: "新建数据表、动态加减字段" },
  { label: "导入 Excel", to: "/import", desc: "批量导入攻关单和其他数据" },
  { label: "实体合并", to: "/merge", desc: "将重复人员/实体合并为一" },
  { label: "审计日志", to: "/audit", desc: "所有变更的完整审计记录" },
  { label: "邮件通知", to: "/email", desc: "邮件通知配置与发送" },
  { label: "责任矩阵", to: "/responsibility", desc: "人员与攻关单关系图" },
];

export function SettingsPage() {
  const [escalationJson, setEscalationJson] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/escalation/config")
      .then(r => r.json())
      .then(d => setEscalationJson(JSON.stringify(d, null, 2)))
      .catch(() => message.error("上升配置加载失败"));
  }, []);

  const saveEscalation = async () => {
    try {
      const parsed = JSON.parse(escalationJson);
      setSaving(true);
      const r = await fetch("/api/escalation/config", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error); }
      message.success("上升规则已保存");
    } catch (e) { message.error(String((e as Error).message)); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ padding: 24, maxWidth: 960 }}>
      <Title level={3}>系统配置中心</Title>
      <Row gutter={24}>
        <Col span={14}>
          <Card title="SLA 上升规则" style={{ marginBottom: 24 }}
            extra={<Text type="secondary">每5分钟自动扫描</Text>}>
            <Text type="secondary" style={{ display: "block", marginBottom: 8 }}>
              rules 数组：事件级别、slaHours（超时小时）、上升角色
            </Text>
            <Input.TextArea rows={10} value={escalationJson}
              onChange={e => setEscalationJson(e.target.value)}
              style={{ fontFamily: "monospace", fontSize: 12 }} />
            <Button type="primary" loading={saving} style={{ marginTop: 12 }}
              onClick={saveEscalation}>保存</Button>
          </Card>
          <Card title="系统信息">
            <Space direction="vertical">
              <Text>自动扫描间隔：<Text strong>5 分钟</Text></Text>
              <Text>Schema 来源：<Text strong>config/schemas/*.json（热重载）</Text></Text>
              <Text>数据库：<Text strong>SQLite</Text></Text>
            </Space>
          </Card>
        </Col>
        <Col span={10}>
          <Card title="功能入口">
            <List dataSource={QUICK_LINKS} renderItem={item => (
              <List.Item>
                <Space direction="vertical" size={0}>
                  <Link to={item.to}><Text strong>{item.label}</Text></Link>
                  <Text type="secondary" style={{ fontSize: 12 }}>{item.desc}</Text>
                </Space>
              </List.Item>
            )} />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
