import { useEffect, useState } from "react";
import {
  Typography,
  DatePicker,
  Statistic,
  Row,
  Col,
  Descriptions,
  Card,
  List,
  Button,
  message,
  Empty,
  Skeleton,
  Tag,
  Space,
  theme,
  Modal,
  Select,
} from "antd";
import { CopyOutlined, LeftOutlined, RightOutlined, SendOutlined, MailOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { api } from "../api.js";
import { STATUS_COLOR } from "../constants.js";
import { copyToClipboard } from "../utils/clipboard.js";
import { useNavigate } from "react-router-dom";
import StatusTag from "../components/StatusTag.js";
import type { DailyReport } from "@combat/shared";
import HelpButton from "../components/HelpButton.js";
import HELP from "../help-content.js";
import { handleApiError } from "../utils/handleApiError.js";

function reportToText(r: DailyReport): string {
  const lines: string[] = [];
  lines.push(`攻关日报 - ${r.date}`);
  lines.push(`被触达攻关单 ${r.summary.ticketsTouched} · 进展条目 ${r.summary.entriesTotal}`);
  const status = Object.entries(r.summary.openByStatus)
    .map(([s, n]) => `${s}:${n}`)
    .join(" / ");
  if (status) lines.push(`状态分布: ${status}`);
  lines.push("");
  for (const s of r.sections) {
    lines.push(`【${s.标题}】（${s.latestStatus}）`);
    for (const e of s.entries) {
      lines.push(`  #${e.seqNo} [${e.statusSnapshot}] ${e.content} — ${e.updatedBy} @ ${e.at}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

export default function DailyReportPage() {
  const [date, setDate] = useState<Dayjs>(dayjs());
  const [r, setR] = useState<DailyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [sending, setSending] = useState(false);
  const [collected, setCollected] = useState<string[]>([]);
  const [groupOptions, setGroupOptions] = useState<string[]>([]);
  const [notifyGroups, setNotifyGroups] = useState<string[]>([]);
  const { token } = theme.useToken();
  const navigate = useNavigate();

  useEffect(() => {
    setLoading(true);
    api
      .getDailyReport(date.format("YYYY-MM-DD"))
      .then(setR)
      .catch(() => {
        setR(null);
      })
      .finally(() => setLoading(false));
  }, [date]);

  const copy = async () => {
    if (!r) return;
    const ok = await copyToClipboard(reportToText(r));
    if (ok) message.success("已复制到剪贴板");
    else message.error("复制失败");
  };

  const publish = async () => {
    setPublishing(true);
    try {
      const result = await api.publishDailyReport(date.format("YYYY-MM-DD"));
      message.success(`已发布：触达 ${result.ticketsTouched} 单，发布 ${result.published} 条`);
    } catch (e) {
      handleApiError(e);
    } finally {
      setPublishing(false);
    }
  };

  const openNotify = async () => {
    if (!r) return;
    setCollecting(true);
    try {
      const persons = new Set<string>();
      const tickets = await api.listNodes("attackTicket").catch(() => []);
      const byId = new Map(tickets.map((t) => [t.id, t]));
      for (const s of r.sections) {
        const t = byId.get(s.ticketId);
        if (!t) continue;
        for (const f of ["当前处理人", "攻关组长", "攻关申请人"]) {
          const v = String(t.properties[f] ?? "").trim();
          if (v) persons.add(v);
        }
        for (const m of String(t.properties["攻关成员"] ?? "").split(/[,，、\s]+/)) {
          const v = m.trim();
          if (v) persons.add(v);
        }
      }
      const snLists = await Promise.all(r.sections.map((s) => api.listSupportNodes(s.ticketId).catch(() => [])));
      for (const list of snLists)
        for (const sn of list) {
          const v = String(sn.personName ?? "").trim();
          if (v) persons.add(v);
        }
      setCollected([...persons]);
      const groups = await api.listNodes("emailGroup").catch(() => []);
      setGroupOptions(groups.map((g) => String(g.properties["组名"] ?? "")).filter(Boolean));
      setNotifyGroups([]);
      setNotifyOpen(true);
    } finally {
      setCollecting(false);
    }
  };

  const sendNotify = async () => {
    if (!r) return;
    setSending(true);
    try {
      const res = await api.sendEmail({
        subject: `攻关日报 ${r.date}`,
        body: reportToText(r),
        personNames: collected,
        groupNames: notifyGroups,
      });
      if (res.ok) {
        message.success(`已发送给 ${res.recipients.length} 个收件人`);
        setNotifyOpen(false);
      } else message.error(`发送失败：${res.error || "未知错误"}`);
    } catch (e) {
      handleApiError(e);
    } finally {
      setSending(false);
    }
  };

  const shiftDate = (delta: number) => setDate((d) => d.add(delta, "day"));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            攻关日报
          </Typography.Title>
          <HelpButton title={HELP.dailyReport.title} content={HELP.dailyReport.content} />
        </div>
      </div>
      <Row gutter={16} align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <Space>
            <Button icon={<LeftOutlined />} size="small" onClick={() => shiftDate(-1)} />
            <Button size="small" onClick={() => setDate(dayjs())}>
              今天
            </Button>
            <Button icon={<RightOutlined />} size="small" onClick={() => shiftDate(1)} />
          </Space>
        </Col>
        <Col>
          <DatePicker value={date} onChange={(d) => d && setDate(d)} />
        </Col>
        <Col>
          <Space>
            <Button icon={<CopyOutlined />} onClick={copy} disabled={!r || loading}>
              复制
            </Button>
            <Button icon={<SendOutlined />} onClick={publish} loading={publishing} disabled={!r || loading}>
              发布日报
            </Button>
            <Button
              icon={<MailOutlined />}
              onClick={async () => {
                await publish();
                await openNotify();
              }}
              loading={collecting}
              disabled={!r || loading}
              type="primary"
            >
              发布并通知
            </Button>
          </Space>
        </Col>
      </Row>

      {loading ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : !r ? (
        <Empty description="该日无日报数据" />
      ) : (
        <>
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col>
              <Card size="small">
                <Statistic title="被触达攻关单" value={r.summary.ticketsTouched} />
              </Card>
            </Col>
            <Col>
              <Card size="small">
                <Statistic title="进展条目数" value={r.summary.entriesTotal} />
              </Card>
            </Col>
            {Object.entries(r.summary.openByStatus).map(([s, n]) => (
              <Col key={s}>
                <Card size="small">
                  <Statistic title={s} value={n} valueStyle={{ color: STATUS_COLOR[s] ?? undefined }} />
                </Card>
              </Col>
            ))}
          </Row>
          {r.sections.length === 0 && <Empty description="该日无进展记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          {r.sections.map((s) => (
            <Card
              key={s.ticketId}
              size="small"
              style={{ marginBottom: 12 }}
              title={
                <Space>
                  <span>【{s.标题}】</span>
                  <StatusTag status={s.latestStatus} />
                </Space>
              }
              extra={
                <a onClick={() => navigate(`/attack/${s.ticketId}`)} style={{ fontSize: 12, cursor: "pointer" }}>
                  查看详情
                </a>
              }
            >
              <List
                size="small"
                dataSource={s.entries}
                rowKey={(e) => `${s.ticketId}-${e.seqNo}`}
                renderItem={(e) => (
                  <List.Item>
                    <div style={{ flex: 1 }}>
                      <div>
                        <Tag style={{ marginRight: 8 }}>#{e.seqNo}</Tag>
                        <StatusTag status={e.statusSnapshot} />
                        <span style={{ marginLeft: 8 }}>{e.content}</span>
                      </div>
                      <div style={{ fontSize: 12, color: token.colorTextSecondary, marginTop: 4 }}>
                        — {e.updatedBy} @ {e.at}
                      </div>
                    </div>
                  </List.Item>
                )}
              />
            </Card>
          ))}
        </>
      )}

      <Modal
        title="邮件通知 — 发送日报"
        open={notifyOpen}
        onCancel={() => setNotifyOpen(false)}
        onOk={sendNotify}
        okText="发送"
        confirmLoading={sending}
        width={560}
        destroyOnClose
      >
        <Space direction="vertical" style={{ width: "100%" }} size={12}>
          <div>
            <Typography.Text type="secondary">
              从当天日报涉及的攻关单自动收集相关人（处理人/组长/申请人/成员/求助网络负责人）：
            </Typography.Text>
            <div style={{ marginTop: 6 }}>
              {collected.length === 0 ? (
                <Typography.Text type="secondary">未收集到相关人</Typography.Text>
              ) : (
                collected.map((n) => (
                  <Tag key={n} style={{ marginBottom: 4 }}>
                    {n}
                  </Tag>
                ))
              )}
            </div>
          </div>
          <div>
            <Typography.Text type="secondary">追加邮件群组（如领导组，可多选）：</Typography.Text>
            <Select
              mode="multiple"
              allowClear
              style={{ width: "100%", marginTop: 6 }}
              placeholder="选择邮件群组"
              value={notifyGroups}
              onChange={setNotifyGroups}
              options={groupOptions.map((g) => ({ value: g, label: g }))}
              notFoundContent="暂无群组，请到「邮件设置」配置"
            />
          </div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            人名将解析为人员邮箱、群组展开为成员邮箱，后端合并去重后发送；正文为当天日报内容。需先在「邮件设置」配置
            SMTP。
          </Typography.Text>
        </Space>
      </Modal>
    </div>
  );
}
