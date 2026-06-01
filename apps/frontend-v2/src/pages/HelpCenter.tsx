import { useEffect, useState, useCallback, useRef } from "react";
import {
  Typography,
  Table,
  Button,
  Space,
  Select,
  Drawer,
  Form,
  Input,
  message,
  Tag,
  Empty,
  Skeleton,
  Descriptions,
  Divider,
  Badge,
} from "antd";
import { PlusOutlined, SearchOutlined, ReloadOutlined, CopyOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import type { HelpRequest } from "../api.js";
import { HELP_STATUS_COLOR, PAGE_SIZE } from "../constants.js";
import { useSettings } from "../hooks/useSettings.js";
import { copyToClipboard } from "../utils/clipboard.js";
import type { GraphNode } from "@combat/shared";
import HelpButton from "../components/HelpButton.js";
import HELP from "../help-content.js";
import dayjs from "dayjs";
import { handleApiError } from "../utils/handleApiError.js";
import { useNodeSchema, editableFieldsOf } from "../hooks/useSchema.js";
import { SchemaFormBody } from "../components/SchemaField.js";

const { Title, Text } = Typography;

export default function HelpCenter() {
  const { getValues } = useSettings();
  const CATEGORY_OPTIONS = getValues("求助分类", ["环境", "领域专家", "团队协作", "资源"]);
  const HELP_STATUS_OPTIONS = getValues("求助中心状态", ["待回复", "已回复"]);
  const [requests, setRequests] = useState<HelpRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [searchText, setSearchText] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [people, setPeople] = useState<GraphNode[]>([]);
  const [tickets, setTickets] = useState<GraphNode[]>([]);
  const [detailReq, setDetailReq] = useState<HelpRequest | null>(null);
  const [hasNewReply, setHasNewReply] = useState(false);
  const seenRepliedRef = useRef<Set<string> | null>(null);
  const navigate = useNavigate();
  // v2.3.5: 创建求助抽屉 schema 驱动 — 字段定义来自 helpRequest virtual schema
  const { schema: helpSchema } = useNodeSchema("helpRequest");
  const helpFields = editableFieldsOf(helpSchema);

  const feedbackUrl = (r: HelpRequest) => `${window.location.origin}/help/feedback/${r.feedbackToken}`;
  const copyLink = async (r: HelpRequest) => {
    const ok = await copyToClipboard(feedbackUrl(r));
    if (ok) message.success("反馈链接已复制");
    else message.warning("复制失败，请手动复制");
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [list, ppl, tkt] = await Promise.all([
        api.listHelpRequests(statusFilter ? { status: statusFilter } : undefined),
        api.listNodes("person").catch(() => []),
        api.listNodes("attackTicket").catch(() => []),
      ]);
      setRequests(list);
      setPeople(ppl);
      setTickets(tkt);
      // Baseline of already-replied ids (use full list so status filter doesn't skew it).
      const full = statusFilter ? await api.listHelpRequests().catch(() => list) : list;
      seenRepliedRef.current = new Set(full.filter((r) => r.status === "已回复").map((r) => r.id));
      setHasNewReply(false);
    } catch (e) {
      handleApiError(e);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Poll for newly-arrived replies; flag the refresh button instead of disrupting the list.
  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const full = await api.listHelpRequests();
        const seen = seenRepliedRef.current;
        if (!seen) return;
        const newlyReplied = full.some((r) => r.status === "已回复" && !seen.has(r.id));
        if (newlyReplied) setHasNewReply(true);
      } catch {
        /* ignore poll errors */
      }
    }, 25000);
    return () => clearInterval(timer);
  }, []);

  const filtered = searchText
    ? requests.filter((r) => {
        const s = searchText.toLowerCase();
        return (
          r.requesterName.toLowerCase().includes(s) ||
          (r.targetName ?? "").toLowerCase().includes(s) ||
          r.question.toLowerCase().includes(s) ||
          r.category.toLowerCase().includes(s)
        );
      })
    : requests;

  const handleSubmit = async (values: any) => {
    setSubmitting(true);
    try {
      const res = await api.createHelpRequest({
        ticketId: values.ticketId,
        requesterName: values.requesterName,
        targetName: values.targetName,
        targetEmail: values.targetEmail,
        category: values.category,
        question: values.question,
        extraNote: values.extraNote,
      });
      if (res.emailSent) {
        message.success("求助邮件已发送");
      } else {
        message.warning(
          `求助已创建，但邮件未发送（${res.emailNote || "邮箱未配置"}）。请到「邮件设置」配置 SMTP；或手动把反馈链接发给对方。`,
          8
        );
      }
      setDrawerOpen(false);
      form.resetFields();
      fetchData();
    } catch (e) {
      handleApiError(e);
    } finally {
      setSubmitting(false);
    }
  };

  const ticketOptions = tickets.map((t) => ({
    value: t.id,
    label: `${(t.properties["标题"] as string) ?? "(无标题)"}${t.properties["问题单号"] ? ` · ${t.properties["问题单号"]}` : ""}`,
  }));

  const personOptions = people.map((p) => ({
    value: (p.properties["姓名"] as string) ?? "",
    label: `${p.properties["姓名"] ?? p.id} (${p.properties["邮箱"] ?? "-"})`,
    email: (p.properties["邮箱"] as string) ?? "",
  }));

  const columns = [
    {
      title: "攻关单",
      dataIndex: "ticketId",
      width: 100,
      render: (v: string) => <a onClick={() => navigate(`/attack/${v}`)}>{v.slice(0, 8)}</a>,
    },
    {
      title: "求助对象",
      width: 100,
      ellipsis: true,
      render: (_: unknown, r: HelpRequest) => r.targetName ?? r.targetEmail,
    },
    {
      title: "类型",
      dataIndex: "category",
      width: 90,
    },
    {
      title: "内容摘要",
      dataIndex: "question",
      ellipsis: true,
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 80,
      render: (v: string) => <Tag color={HELP_STATUS_COLOR[v] ?? "default"}>{v}</Tag>,
    },
    {
      title: "时间",
      dataIndex: "createdAt",
      width: 100,
      render: (v: string) => dayjs(v).format("MM/DD HH:mm"),
    },
    {
      title: "操作",
      width: 120,
      render: (_: unknown, r: HelpRequest) => (
        <Space size={8}>
          <a onClick={() => setDetailReq(r)}>{r.status === "已回复" ? "查看回复" : "查看"}</a>
          {r.status !== "已回复" && <a onClick={() => copyLink(r)}>复制链接</a>}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Title level={4} style={{ margin: 0 }}>
            求助中心
          </Title>
          <HelpButton title={HELP.helpCenter.title} content={HELP.helpCenter.content} />
        </div>
        <Space>
          <Badge dot={hasNewReply} offset={[-2, 2]}>
            <Button
              icon={<ReloadOutlined />}
              onClick={fetchData}
              type={hasNewReply ? "primary" : "default"}
              danger={hasNewReply}
            >
              {hasNewReply ? "有新回复，点击刷新" : "刷新"}
            </Button>
          </Badge>
          <Button icon={<PlusOutlined />} type="primary" onClick={() => setDrawerOpen(true)}>
            发起求助
          </Button>
        </Space>
      </div>

      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          placeholder="状态筛选"
          allowClear
          style={{ width: 120 }}
          value={statusFilter}
          onChange={setStatusFilter}
          options={HELP_STATUS_OPTIONS.map((s) => ({ value: s, label: s }))}
        />
        <Input
          placeholder="搜索"
          prefix={<SearchOutlined />}
          style={{ width: 220 }}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          allowClear
        />
      </Space>

      {loading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : filtered.length === 0 ? (
        <Empty description="暂无求助记录" />
      ) : (
        <Table
          rowKey="id"
          dataSource={filtered}
          columns={columns}
          pagination={{ pageSize: PAGE_SIZE, showSizeChanger: false, showTotal: (t) => `共 ${t} 条` }}
          size="middle"
        />
      )}

      <Drawer
        title="发起求助"
        width={520}
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          form.resetFields();
        }}
        extra={
          <Button type="primary" loading={submitting} onClick={() => form.submit()}>
            发送求助邮件
          </Button>
        }
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          {/* v2.3.5: schema 驱动 — helpRequest virtual schema 决定字段 + 分组 */}
          <SchemaFormBody
            fields={helpFields}
            personOptions={personOptions.map((p) => ({ value: p.value, label: p.label }))}
            refOptions={{
              attackTicket: ticketOptions,
              person: personOptions.map((p) => ({ value: p.value, label: p.label })),
            }}
            renderField={(f) => {
              // 求助对象选定后自动填邮箱(联动逻辑保留 — schema 表达不了)
              if (f.name === "targetName") {
                return (
                  <Form.Item name={f.name} label={f.label}>
                    <Select
                      showSearch
                      allowClear
                      placeholder="从全员名单搜索"
                      options={personOptions}
                      filterOption={(input, option) =>
                        (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
                      }
                      onChange={(val) => {
                        const person = personOptions.find((p) => p.value === val);
                        if (person?.email) form.setFieldValue("targetEmail", person.email);
                      }}
                    />
                  </Form.Item>
                );
              }
              // schema 里 category 是 enum,enumValues 默认走 schema;若 settings 覆盖了求助分类,优先用 settings
              if (f.name === "category" && CATEGORY_OPTIONS.length > 0) {
                return (
                  <Form.Item name={f.name} label={f.label} rules={[{ required: true, message: "请选择求助类型" }]}>
                    <Select options={CATEGORY_OPTIONS.map((c) => ({ value: c, label: c }))} />
                  </Form.Item>
                );
              }
              return null;
            }}
          />
        </Form>
      </Drawer>

      <Drawer title="求助详情" width={520} open={!!detailReq} onClose={() => setDetailReq(null)} destroyOnClose>
        {detailReq && (
          <>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="攻关单">
                <a
                  onClick={() => {
                    navigate(`/attack/${detailReq.ticketId}`);
                  }}
                >
                  {detailReq.ticketId.slice(0, 8)}
                </a>
              </Descriptions.Item>
              <Descriptions.Item label="求助人">{detailReq.requesterName}</Descriptions.Item>
              <Descriptions.Item label="求助对象">{detailReq.targetName ?? detailReq.targetEmail}</Descriptions.Item>
              <Descriptions.Item label="类型">{detailReq.category}</Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={HELP_STATUS_COLOR[detailReq.status] ?? "default"}>{detailReq.status}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="求助内容">
                <div style={{ whiteSpace: "pre-wrap" }}>{detailReq.question}</div>
              </Descriptions.Item>
              <Descriptions.Item label="发起时间">
                {dayjs(detailReq.createdAt).format("YYYY-MM-DD HH:mm")}
              </Descriptions.Item>
            </Descriptions>

            <Divider orientation="left" orientationMargin={0}>
              回复
            </Divider>
            {detailReq.status === "已回复" ? (
              <Descriptions column={1} size="small" bordered>
                <Descriptions.Item label="回复内容">
                  <div style={{ whiteSpace: "pre-wrap" }}>{detailReq.feedback || "—"}</div>
                </Descriptions.Item>
                <Descriptions.Item label="回复人">{detailReq.feedbackBy || "—"}</Descriptions.Item>
                <Descriptions.Item label="回复时间">
                  {detailReq.feedbackAt ? dayjs(detailReq.feedbackAt).format("YYYY-MM-DD HH:mm") : "—"}
                </Descriptions.Item>
              </Descriptions>
            ) : (
              <div>
                <Text type="secondary">尚未回复。可将以下反馈链接发给求助对象：</Text>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <Input readOnly value={feedbackUrl(detailReq)} />
                  <Button icon={<CopyOutlined />} onClick={() => copyLink(detailReq)}>
                    复制
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Drawer>
    </div>
  );
}
