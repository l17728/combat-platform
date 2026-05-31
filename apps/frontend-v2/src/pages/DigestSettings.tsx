import React, { useState, useEffect, useCallback } from "react";
import {
  Card,
  Form,
  Switch,
  Select,
  Input,
  Button,
  Space,
  message,
  Divider,
  Table,
  Tag,
  Alert,
  Spin,
  Statistic,
  Row,
  Col,
} from "antd";
import { MailOutlined, SendOutlined, EyeOutlined } from "@ant-design/icons";
import { InputNumber } from "antd";
import { api } from "../api.js";
import HelpButton from "../components/HelpButton.js";
import HELP from "../help-content.js";

interface DigestConfig {
  id: string;
  enabled: boolean;
  frequency: "daily" | "weekly";
  recipients: string[];
  includeStats: boolean;
  includeNewTickets: boolean;
  includeTransitions: boolean;
  includeContributions: boolean;
  lastSentAt: string | null;
  updatedAt: string;
}

interface DigestPreview {
  since: string;
  newTickets: { id: string; title: string; status: string }[];
  transitions: { id: string; title: string; from: string; to: string; time: string }[];
  newContributions: { id: string; person: string; type: string; level: string }[];
  stats: { totalTickets: number; openTickets: number; resolvedToday: number; totalContributions: number };
}

const STATUS_COLOR: Record<string, string> = {
  待响应: "gold",
  处理中: "blue",
  进行中: "cyan",
  已解决: "green",
  已关闭: "default",
};

export default function DigestSettings() {
  const [config, setConfig] = useState<DigestConfig | null>(null);
  const [preview, setPreview] = useState<DigestPreview | null>(null);
  const [previewDays, setPreviewDays] = useState<number>(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [form] = Form.useForm();

  const fetchConfig = useCallback(async () => {
    try {
      const data = await api.getDigestConfig();
      setConfig(data);
      form.setFieldsValue({
        enabled: data.enabled,
        frequency: data.frequency,
        recipients: data.recipients,
        includeStats: data.includeStats,
        includeNewTickets: data.includeNewTickets,
        includeTransitions: data.includeTransitions,
        includeContributions: data.includeContributions,
      });
    } catch (e: any) {
      message.error("加载失败: " + e.message);
    } finally {
      setLoading(false);
    }
  }, [form]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const handleSave = async () => {
    try {
      setSaving(true);
      const values = await form.validateFields();
      const res = await api.updateDigestConfig(values);
      setConfig(res);
      message.success("保存成功");
    } catch (e: any) {
      if (e.message) message.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handlePreview = async () => {
    try {
      const data = await api.previewDigest(previewDays);
      setPreview(data);
    } catch (e: any) {
      message.error("预览失败: " + e.message);
    }
  };

  const handleSend = async () => {
    try {
      setSending(true);
      const res = await api.sendDigest(previewDays);
      if (res.sent) {
        message.success("已发送");
        fetchConfig();
      } else {
        message.warning(res.error || "发送失败");
      }
    } catch (e: any) {
      message.error("发送失败: " + e.message);
    } finally {
      setSending(false);
    }
  };

  if (loading) return <Spin style={{ display: "block", margin: "100px auto" }} />;

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <h4 style={{ margin: 0 }}>邮件摘要</h4>
        <Space>
          <HelpButton title={HELP.digestSettings.title} content={HELP.digestSettings.content} />
          <span style={{ fontSize: 13, color: "#666" }}>天数</span>
          <InputNumber
            min={1}
            max={90}
            value={previewDays}
            onChange={(v) => setPreviewDays(v || 1)}
            size="small"
            style={{ width: 70 }}
          />
          <Button icon={<EyeOutlined />} onClick={handlePreview}>
            预览
          </Button>
          <Button icon={<SendOutlined />} loading={sending} onClick={handleSend}>
            立即发送
          </Button>
        </Space>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="定时邮件摘要功能。启用后系统每天（或每周）自动汇总新建攻关单、状态流转、新增贡献等信息，发送到指定邮箱。需要先在「邮件设置」中配置 SMTP。"
      />

      <Card size="small" style={{ marginBottom: 16 }}>
        <Form form={form} layout="vertical">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="enabled" label="启用" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="frequency" label="发送频率">
                <Select
                  options={[
                    { value: "daily", label: "每天" },
                    { value: "weekly", label: "每周" },
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            name="recipients"
            label="收件人（每行一个邮箱）"
            rules={[{ required: true, message: "至少一个收件人" }]}
          >
            <Select mode="tags" placeholder="输入邮箱后按回车" tokenSeparators={[",", " "]} />
          </Form.Item>

          <Divider orientation="left" orientationMargin={0}>
            摘要内容
          </Divider>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="includeStats" label="总体统计" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="includeNewTickets" label="新建攻关单" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="includeTransitions" label="状态流转" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="includeContributions" label="新增贡献" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item>
            <Button type="primary" loading={saving} onClick={handleSave}>
              保存配置
            </Button>
          </Form.Item>
        </Form>
      </Card>

      {config?.lastSentAt && (
        <Alert
          type="success"
          showIcon
          style={{ marginBottom: 16 }}
          message={`上次发送：${new Date(config.lastSentAt).toLocaleString("zh-CN")}`}
        />
      )}

      {preview && (
        <Card title="摘要预览" size="small">
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col span={6}>
              <Statistic title="总攻关单" value={preview.stats.totalTickets} />
            </Col>
            <Col span={6}>
              <Statistic title="进行中" value={preview.stats.openTickets} />
            </Col>
            <Col span={6}>
              <Statistic title="已解决" value={preview.stats.resolvedToday} />
            </Col>
            <Col span={6}>
              <Statistic title="总贡献" value={preview.stats.totalContributions} />
            </Col>
          </Row>

          {preview.newTickets.length > 0 && (
            <>
              <Divider orientation="left" orientationMargin={0}>
                新建攻关单 ({preview.newTickets.length})
              </Divider>
              <Table
                size="small"
                pagination={false}
                rowKey="id"
                dataSource={preview.newTickets}
                columns={[
                  { title: "标题", dataIndex: "title", ellipsis: true },
                  {
                    title: "状态",
                    dataIndex: "status",
                    width: 100,
                    render: (s: string) => <Tag color={STATUS_COLOR[s] || "default"}>{s}</Tag>,
                  },
                ]}
              />
            </>
          )}

          {preview.transitions.length > 0 && (
            <>
              <Divider orientation="left" orientationMargin={0}>
                状态流转 ({preview.transitions.length})
              </Divider>
              <Table
                size="small"
                pagination={false}
                rowKey="id"
                dataSource={preview.transitions}
                columns={[
                  { title: "标题", dataIndex: "title", ellipsis: true },
                  {
                    title: "变更",
                    width: 200,
                    render: (_: unknown, r: any) => (
                      <span>
                        {r.from} → {r.to}
                      </span>
                    ),
                  },
                  { title: "时间", dataIndex: "time", width: 160 },
                ]}
              />
            </>
          )}

          {preview.newContributions.length > 0 && (
            <>
              <Divider orientation="left" orientationMargin={0}>
                新增贡献 ({preview.newContributions.length})
              </Divider>
              <Table
                size="small"
                pagination={false}
                rowKey="id"
                dataSource={preview.newContributions}
                columns={[
                  { title: "贡献人", dataIndex: "person", width: 120 },
                  { title: "类型", dataIndex: "type", width: 120 },
                  { title: "等级", dataIndex: "level", width: 100 },
                ]}
              />
            </>
          )}

          {preview.newTickets.length === 0 &&
            preview.transitions.length === 0 &&
            preview.newContributions.length === 0 && <Alert type="warning" message="本期无新动态" />}
        </Card>
      )}
    </div>
  );
}
