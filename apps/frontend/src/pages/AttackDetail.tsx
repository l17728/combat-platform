import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import {
  Row, Col, Card, Tag, Tabs, Descriptions, Timeline, Input, Button,
  message, List, Typography, Select, Space, Alert, Table, Modal, Form,
} from "antd";
import { ArrowLeftOutlined, PlusOutlined } from "@ant-design/icons";
import { api } from "../api.js";
import type { GraphNode, NodeSchema, ProgressLog, HelperRecommendation, AuditLogEntry } from "@combat/shared";
import { ATTACK_STATUSES } from "@combat/shared";

interface DailyReportEntryItem {
  id: string;
  ticketId: string;
  type: string;
  currentProgress: string;
  nextSteps: string;
  status: "草稿" | "已发布";
  createdBy: string;
  createdAt: string;
  publishedAt: string | null;
}

const STATUS_COLOR: Record<string, string> = {
  "待响应": "orange",
  "处理中": "blue",
  "进行中": "blue",
  "已解决": "green",
  "已关闭": "default",
};

function fmtDate(iso: string | undefined | null): string {
  if (!iso) return "--";
  try {
    return new Date(iso).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) + " GMT+08:00";
  } catch {
    return iso;
  }
}

function fmtDateShort(iso: string | undefined | null): string {
  if (!iso) return "--";
  try {
    return new Date(iso).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  } catch {
    return iso;
  }
}

function propStr(node: GraphNode | null, key: string): string {
  return String(node?.properties[key] ?? "--");
}

// Fields shown in the summary cards (skip them in Tab 1 basic info)
const SUMMARY_FIELDS = new Set(["问题单号", "事件单号", "事件级别", "影响及现存风险", "问题描述", "故障发生时间", "标题"]);
// Fields shown in the right-side team card (skip them in Tab 1 as well, but actually keep in Tab 1 per spec)
const TEAM_FIELDS = new Set(["攻关组长", "攻关成员"]);

export function AttackDetail() {
  const { id = "" } = useParams();
  const [node, setNode] = useState<GraphNode | null>(null);
  const [schema, setSchema] = useState<NodeSchema | null>(null);
  const [seq, setSeq] = useState<ProgressLog[]>([]);
  const [progressText, setProgressText] = useState("");
  const [helpers, setHelpers] = useState<HelperRecommendation[] | null>(null);
  const [audit, setAudit] = useState<AuditLogEntry[]>([]);
  const [dailyReports, setDailyReports] = useState<DailyReportEntryItem[]>([]);
  const [drLoading, setDrLoading] = useState(false);

  // Transition state
  const [toStatus, setToStatus] = useState<string | undefined>();
  const [note, setNote] = useState("");

  // Daily report modal state
  const [drModalOpen, setDrModalOpen] = useState(false);
  const [drForm] = Form.useForm();
  const [drSubmitting, setDrSubmitting] = useState(false);

  const fetchDailyReports = useCallback(async () => {
    if (!id) return;
    setDrLoading(true);
    try {
      const role = (typeof localStorage !== "undefined" && localStorage.getItem("combat-role")) || "normal";
      const res = await fetch(`/api/nodes/${id}/daily-reports`, { headers: { "X-Role": role } });
      if (res.ok) {
        const data = await res.json();
        setDailyReports(data);
      }
    } catch {
      // ignore
    } finally {
      setDrLoading(false);
    }
  }, [id]);

  const refresh = useCallback(() => {
    api.getNode(id).then(setNode).catch(() => message.error("攻关单加载失败"));
    api.getSchema("attackTicket").then(setSchema).catch(() => {});
    api.listProgress(id).then(setSeq).catch(() => message.error("进展加载失败"));
    api.recommendHelpers(id).then(setHelpers).catch(() => { setHelpers([]); });
    api.listAudit({ entityId: id, limit: 50 }).then(setAudit).catch(() => setAudit([]));
    fetchDailyReports();
  }, [id, fetchDailyReports]);

  useEffect(() => { refresh(); }, [refresh]);

  const addProgress = async () => {
    if (!progressText.trim()) return;
    try {
      await api.appendProgress(id, progressText, String(node?.properties["状态"] ?? ""));
      setProgressText("");
      message.success("已追加进展");
      refresh();
    } catch (e) {
      message.error(String((e as Error).message));
    }
  };

  const doTransition = async () => {
    if (!toStatus) { message.warning("请选择目标状态"); return; }
    try {
      await api.transition(id, toStatus, note || undefined);
      message.success(`已流转到「${toStatus}」`);
      setToStatus(undefined);
      setNote("");
      refresh();
    } catch (e) {
      message.error(String((e as Error).message));
    }
  };

  const createDailyReport = async (values: { type: string; currentProgress: string; nextSteps?: string }) => {
    setDrSubmitting(true);
    try {
      const role = (typeof localStorage !== "undefined" && localStorage.getItem("combat-role")) || "normal";
      const res = await fetch(`/api/nodes/${id}/daily-reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Role": role },
        body: JSON.stringify({ type: values.type, currentProgress: values.currentProgress, nextSteps: values.nextSteps ?? "" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      message.success("日报条目已创建");
      setDrModalOpen(false);
      drForm.resetFields();
      fetchDailyReports();
    } catch (e) {
      message.error(String((e as Error).message));
    } finally {
      setDrSubmitting(false);
    }
  };

  const publishDailyReport = async (eid: string) => {
    try {
      const role = (typeof localStorage !== "undefined" && localStorage.getItem("combat-role")) || "normal";
      const res = await fetch(`/api/nodes/${id}/daily-reports/${eid}/publish`, {
        method: "POST",
        headers: { "X-Role": role },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      message.success("已发布");
      fetchDailyReports();
    } catch (e) {
      message.error(String((e as Error).message));
    }
  };

  const deleteDailyReport = async (eid: string) => {
    try {
      const role = (typeof localStorage !== "undefined" && localStorage.getItem("combat-role")) || "normal";
      const res = await fetch(`/api/nodes/${id}/daily-reports/${eid}`, {
        method: "DELETE",
        headers: { "X-Role": role },
      });
      if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
      message.success("已删除");
      fetchDailyReports();
    } catch (e) {
      message.error(String((e as Error).message));
    }
  };

  const status = propStr(node, "状态");
  const title = propStr(node, "标题");

  // Missing required fields
  const missingFields = schema?.fields.filter(
    (f) => !f.retired && f.required && !node?.properties[f.name]?.toString().trim()
  ) ?? [];

  // Tab 1: basic info fields — exclude summary fields, but keep team fields
  const basicFields = schema?.fields.filter(
    (f) => !f.retired && !SUMMARY_FIELDS.has(f.name)
  ) ?? [];

  // --- Daily reports table columns ---
  const drColumns = [
    { title: "日报类型", dataIndex: "type", key: "type", width: 100 },
    {
      title: "当前进展",
      dataIndex: "currentProgress",
      key: "currentProgress",
      render: (v: string) => v.length > 120 ? v.slice(0, 120) + "…" : v,
    },
    {
      title: "下一步计划",
      dataIndex: "nextSteps",
      key: "nextSteps",
      render: (v: string) => v ? (v.length > 80 ? v.slice(0, 80) + "…" : v) : "--",
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 80,
      render: (v: string) => <Tag color={v === "已发布" ? "green" : "default"}>{v}</Tag>,
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 160,
      render: (v: string) => fmtDateShort(v),
    },
    {
      title: "发布时间",
      dataIndex: "publishedAt",
      key: "publishedAt",
      width: 160,
      render: (v: string | null) => v ? fmtDateShort(v) : "--",
    },
    {
      title: "操作",
      key: "action",
      width: 130,
      render: (_: unknown, record: DailyReportEntryItem) => (
        record.status === "已发布"
          ? <Typography.Text type="secondary">已发布</Typography.Text>
          : (
            <Space size="small">
              <Button size="small" type="primary" onClick={() => publishDailyReport(record.id)}>发布</Button>
              <Button size="small" danger onClick={() => deleteDailyReport(record.id)}>删除</Button>
            </Space>
          )
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      {/* ===== Header ===== */}
      <div style={{ marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Space size={12}>
          <Link to="/attack" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <ArrowLeftOutlined /> 返回
          </Link>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {title}
          </Typography.Title>
          <Tag color={STATUS_COLOR[status] ?? "default"} style={{ fontSize: 14, padding: "2px 10px" }}>
            ● {status}
          </Tag>
        </Space>
        <Space size={8}>
          <Link aria-label="related-link" to={`/related/attackTicket/${id}`}>关联全景</Link>
          <Typography.Text type="secondary">
            创建时间: {fmtDate(node?.createdAt)}
          </Typography.Text>
        </Space>
      </div>

      {/* ===== Summary Cards (two columns) ===== */}
      <Card style={{ marginBottom: 16, background: "#fff", padding: 0 }} bodyStyle={{ padding: 16 }}>
        <Row gutter={24}>
          <Col span={12}>
            <Descriptions column={1} size="small" bordered={false} labelStyle={{ color: "#888", width: 110 }}>
              <Descriptions.Item label="标题">{title}</Descriptions.Item>
              <Descriptions.Item label="问题单号">{propStr(node, "问题单号")}</Descriptions.Item>
              <Descriptions.Item label="事件单号">
                <Typography.Link>{propStr(node, "事件单号")}</Typography.Link>
              </Descriptions.Item>
              <Descriptions.Item label="事件级别">{propStr(node, "事件级别")}</Descriptions.Item>
              <Descriptions.Item label="影响及现存风险">
                <span style={{ whiteSpace: "pre-wrap" }}>{propStr(node, "影响及现存风险")}</span>
              </Descriptions.Item>
              <Descriptions.Item label="问题描述">
                <span style={{ whiteSpace: "pre-wrap" }}>{propStr(node, "问题描述")}</span>
              </Descriptions.Item>
            </Descriptions>
          </Col>
          <Col span={12}>
            <Descriptions column={1} size="small" bordered={false} labelStyle={{ color: "#888", width: 110 }}>
              <Descriptions.Item label="OSM单号">{propStr(node, "问题单号")}</Descriptions.Item>
              <Descriptions.Item label="故障发生时间">{propStr(node, "故障发生时间")}</Descriptions.Item>
            </Descriptions>
          </Col>
        </Row>
      </Card>

      {/* ===== Progress (always visible — §41 progress is append-only time series) ===== */}
      <Card title="进展同步" size="small" style={{ marginBottom: 16 }}>
        <Input.TextArea
          aria-label="progress-input"
          value={progressText}
          onChange={(e) => setProgressText(e.target.value)}
          rows={3}
          placeholder="输入进展内容..."
          style={{ marginBottom: 8 }}
        />
        <Button type="primary" onClick={addProgress} style={{ marginBottom: 16 }}>
          追加进展
        </Button>
        <Timeline
          items={[...seq].reverse().map((p) => ({
            color: "blue",
            children: (
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {fmtDateShort(p.updatedAt)} · {p.updatedBy || "系统"}
                </Typography.Text>
                <div style={{ marginTop: 2 }}>
                  <Tag color="default" style={{ marginRight: 8 }}>#{p.seqNo}</Tag>
                  <Tag color="default" style={{ marginRight: 8 }}>{p.statusSnapshot}</Tag>
                  {p.content}
                </div>
              </div>
            ),
          }))}
        />
      </Card>

      {/* ===== Main Content + Right Sidebar ===== */}
      <Row gutter={16}>
        {/* ===== Main Content Col ===== */}
        <Col span={18}>
          <Card bodyStyle={{ padding: 0 }}>
            <Tabs
              defaultActiveKey="basic"
              style={{ padding: "0 16px" }}
              items={[
                {
                  key: "basic",
                  label: "基础信息",
                  children: (
                    <div style={{ padding: "16px 0" }}>
                      {/* Missing fields alert */}
                      {missingFields.length > 0 && (
                        <Alert
                          type="warning"
                          message={`以下必填信息尚未填写：${missingFields.map((f) => f.label).join("、")}`}
                          description="请点击编辑补充完整，完成后保存入库"
                          showIcon
                          style={{ marginBottom: 16 }}
                          closable
                        />
                      )}

                      {/* Basic fields */}
                      <Descriptions bordered column={2} size="small" style={{ marginBottom: 24 }}>
                        {basicFields.map((f) => (
                          <Descriptions.Item key={f.name} label={f.label}>
                            {String(node?.properties[f.name] ?? "--")}
                          </Descriptions.Item>
                        ))}
                      </Descriptions>

                      {/* Status transition */}
                      <div aria-label="transition" style={{ marginTop: 8, borderTop: "1px solid #f0f0f0", paddingTop: 16 }}>
                        <Typography.Title level={5} style={{ marginBottom: 12 }}>状态流转</Typography.Title>
                        <Space>
                          <Select
                            aria-label="transition-status"
                            placeholder="目标状态"
                            style={{ width: 140 }}
                            value={toStatus}
                            onChange={setToStatus}
                            options={ATTACK_STATUSES.map((s) => ({ value: s, label: s }))}
                          />
                          <Input
                            aria-label="transition-note"
                            placeholder="备注（可选）"
                            style={{ width: 280 }}
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                          />
                          <Button type="primary" onClick={doTransition}>流转</Button>
                        </Space>
                      </div>

                      {/* Find helpers */}
                      <div aria-label="find-helpers" style={{ marginTop: 24, borderTop: "1px solid #f0f0f0", paddingTop: 16 }}>
                        <Typography.Title level={5} style={{ marginBottom: 8 }}>找帮手</Typography.Title>
                        {helpers !== null && helpers.length === 0 && (
                          <Typography.Text role="status" type="secondary">暂无可推荐人选</Typography.Text>
                        )}
                        {helpers && helpers.length > 0 && (
                          <List
                            size="small"
                            dataSource={helpers}
                            rowKey={(h) => h.person.id}
                            renderItem={(h) => (
                              <List.Item>
                                <Link to={`/related/person/${h.person.id}`}>
                                  {String(h.person.properties["name"] ?? h.person.id)}
                                </Link>
                                <span style={{ marginLeft: 8, color: "#888" }}>
                                  [{h.score}] {h.reasons.join("；")}
                                </span>
                              </List.Item>
                            )}
                          />
                        )}
                      </div>
                    </div>
                  ),
                },
                {
                  key: "dailyReport",
                  label: "日报更新",
                  children: (
                    <div style={{ padding: "16px 0" }}>
                      <div style={{ marginBottom: 16 }}>
                        <Button
                          type="primary"
                          icon={<PlusOutlined />}
                          onClick={() => { drForm.resetFields(); setDrModalOpen(true); }}
                        >
                          创建
                        </Button>
                      </div>
                      <Table
                        size="small"
                        loading={drLoading}
                        dataSource={dailyReports}
                        columns={drColumns}
                        rowKey="id"
                        pagination={{ pageSize: 10 }}
                      />
                      <Modal
                        title="创建日报条目"
                        open={drModalOpen}
                        onCancel={() => setDrModalOpen(false)}
                        footer={null}
                        destroyOnClose
                      >
                        <Form
                          form={drForm}
                          layout="vertical"
                          initialValues={{ type: "进展通报" }}
                          onFinish={createDailyReport}
                        >
                          <Form.Item name="type" label="日报类型">
                            <Select
                              options={[
                                { value: "进展通报", label: "进展通报" },
                                { value: "风险通报", label: "风险通报" },
                              ]}
                            />
                          </Form.Item>
                          <Form.Item name="currentProgress" label="当前进展" rules={[{ required: true, message: "当前进展必填" }]}>
                            <Input.TextArea rows={4} placeholder="请输入当前进展..." />
                          </Form.Item>
                          <Form.Item name="nextSteps" label="下一步计划">
                            <Input.TextArea rows={3} placeholder="请输入下一步计划..." />
                          </Form.Item>
                          <Form.Item style={{ marginBottom: 0, textAlign: "right" }}>
                            <Space>
                              <Button onClick={() => setDrModalOpen(false)}>取消</Button>
                              <Button type="primary" htmlType="submit" loading={drSubmitting}>提交</Button>
                            </Space>
                          </Form.Item>
                        </Form>
                      </Modal>
                    </div>
                  ),
                },
                {
                  key: "audit",
                  label: "历史记录",
                  children: (
                    <div style={{ padding: "16px 0" }}>
                      {audit.length === 0 ? (
                        <Typography.Text type="secondary">暂无审计记录</Typography.Text>
                      ) : (
                        <Timeline
                          items={audit.map((a) => ({
                            color: "green",
                            children: (
                              <div>
                                <Typography.Text strong style={{ marginRight: 8 }}>{a.performedBy}</Typography.Text>
                                <Typography.Text>{a.action}</Typography.Text>
                                <div>
                                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                    {fmtDateShort(a.performedAt)}
                                  </Typography.Text>
                                </div>
                              </div>
                            ),
                          }))}
                        />
                      )}
                    </div>
                  ),
                },
              ]}
            />
          </Card>
        </Col>

        {/* ===== Right Sidebar ===== */}
        <Col span={6}>
          <Card title="攻关成员" size="small">
            <Descriptions column={1} size="small" bordered={false} labelStyle={{ color: "#888" }}>
              <Descriptions.Item label="攻关组长">
                {propStr(node, "攻关组长")}
              </Descriptions.Item>
              <Descriptions.Item label="攻关成员">
                {propStr(node, "攻关成员")}
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
