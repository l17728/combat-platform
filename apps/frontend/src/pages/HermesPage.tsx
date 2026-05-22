import { useState, useEffect } from "react";
import { Button, Card, Input, List, Tag, Typography, message, Tooltip, Collapse, Badge } from "antd";
import { PushpinOutlined, PushpinFilled, DeleteOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { UiWidget } from "../components/UiWidget.js";
import type { HermesAnswer, HermesIntent, PinnedUi } from "@combat/shared";

const INTENT_LABEL: Record<HermesIntent, string> = {
  status: "进展",
  owner: "负责人",
  "ticket-by-pb": "问题单关联",
  "person-workload": "人员负载",
  "fallback-search": "全文检索",
  "contribution-by-person": "贡献查询",
  "recent-changes": "近期变更",
  "find-helpers": "找帮手",
};
const INTENT_COLOR: Record<HermesIntent, string> = {
  status: "blue",
  owner: "geekblue",
  "ticket-by-pb": "purple",
  "person-workload": "magenta",
  "fallback-search": "default",
  "contribution-by-person": "gold",
  "recent-changes": "cyan",
  "find-helpers": "volcano",
};

const PLACEHOLDER = [
  "示例：",
  "· PB-12345 涉及哪些单？",
  "· 断网攻关 谁负责？",
  "· 数据迁移攻关 现在状态",
  "· 张三 贡献了什么？",
  "· 今天 谁动了什么？",
  "· PB-12345 找谁帮忙？",
].join("\n");

async function loadPinned(): Promise<PinnedUi[]> {
  const r = await fetch("/api/ui-cache/pinned");
  return r.ok ? r.json() : [];
}
async function savePin(ans: HermesAnswer): Promise<PinnedUi> {
  const r = await fetch("/api/ui-cache/pin", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ label: ans.question, question: ans.question, intent: ans.intent, uiSpec: ans.uiSpec }),
  });
  if (!r.ok) throw new Error("固定失败");
  return r.json();
}
async function removePin(id: string): Promise<void> {
  await fetch(`/api/ui-cache/pinned/${id}`, { method: "DELETE" });
}

export function HermesPage() {
  const [q, setQ] = useState("");
  const [history, setHistory] = useState<HermesAnswer[]>([]);
  const [active, setActive] = useState<HermesAnswer | null>(null);
  const [loading, setLoading] = useState(false);
  const [pinned, setPinned] = useState<PinnedUi[]>([]);
  const [showWidget, setShowWidget] = useState(true);

  useEffect(() => { loadPinned().then(setPinned); }, []);

  const ask = async () => {
    const text = q.trim();
    if (!text) { message.warning("请输入问题"); return; }
    setLoading(true);
    try {
      const ans = await api.hermesAsk(text);
      setActive(ans);
      setHistory(h => [ans, ...h].slice(0, 20));
      setQ("");
    } catch (e) { message.error(String((e as Error).message)); }
    finally { setLoading(false); }
  };

  const pin = async (ans: HermesAnswer) => {
    if (!ans.uiSpec) { message.info("该回答无可固定的 UI 组件"); return; }
    try {
      const p = await savePin(ans);
      setPinned(ps => [p, ...ps]);
      message.success("已固定到侧栏");
    } catch { message.error("固定失败"); }
  };
  const unpin = async (id: string) => {
    await removePin(id);
    setPinned(ps => ps.filter(p => p.id !== id));
  };
  const loadPin = (p: PinnedUi) => {
    setActive({ question: p.question, intent: p.intent as HermesIntent, answer: "", citations: [], uiSpec: p.uiSpec });
  };

  return (
    <div style={{ padding: 16, display: "grid", gridTemplateColumns: "260px 1fr", gap: 16 }}>
      {/* Left sidebar: history + pinned */}
      <div>
        <Typography.Title level={5}>历史问题</Typography.Title>
        <List size="small" dataSource={history} locale={{ emptyText: "暂无历史" }}
          rowKey={(h) => h.question + h.intent}
          renderItem={(h) => (
            <List.Item style={{ cursor: "pointer" }} onClick={() => setActive(h)}>
              <Typography.Text ellipsis>{h.question}</Typography.Text>
            </List.Item>
          )} />

        {pinned.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <Typography.Title level={5}>
              <PushpinFilled style={{ color: "#1677ff", marginRight: 4 }} />
              已固定 <Badge count={pinned.length} style={{ backgroundColor: "#1677ff" }} />
            </Typography.Title>
            <List size="small" dataSource={pinned} locale={{ emptyText: "暂无固定" }}
              rowKey={(p) => p.id}
              renderItem={(p) => (
                <List.Item style={{ cursor: "pointer" }}
                  actions={[
                    <Tooltip title="取消固定" key="del">
                      <DeleteOutlined style={{ color: "#999" }} onClick={(e) => { e.stopPropagation(); unpin(p.id); }} />
                    </Tooltip>
                  ]}
                  onClick={() => loadPin(p)}>
                  <Typography.Text ellipsis style={{ maxWidth: 140 }}>{p.label}</Typography.Text>
                </List.Item>
              )} />
          </div>
        )}
      </div>

      {/* Main area */}
      <div>
        <Typography.Title level={3} style={{ marginTop: 0 }}>Hermes 问答</Typography.Title>
        <Input.TextArea aria-label="hermes-question" rows={3} value={q} placeholder={PLACEHOLDER}
          onChange={(e) => setQ(e.target.value)} onPressEnter={(e) => { if (!e.shiftKey) { e.preventDefault(); ask(); } }} />
        <div style={{ marginTop: 8, marginBottom: 16 }}>
          <Button type="primary" loading={loading} onClick={ask}>提问</Button>
          <Typography.Text type="secondary" style={{ marginLeft: 12 }}>Enter 提交 · Shift+Enter 换行</Typography.Text>
        </div>
        {active && (
          <Card aria-label="hermes-answer"
            title={
              <span>
                <Tag color={INTENT_COLOR[active.intent] ?? "default"}>{INTENT_LABEL[active.intent] ?? active.intent}</Tag>
                <span style={{ marginLeft: 8 }}>{active.question}</span>
              </span>
            }
            extra={
              active.uiSpec && (
                <Tooltip title="固定此 UI 到侧栏，方便下次快速查看">
                  <Button size="small" icon={<PushpinOutlined />} onClick={() => pin(active)}>固定</Button>
                </Tooltip>
              )
            }>
            {active.answer && (
              <Typography.Paragraph style={{ whiteSpace: "pre-line" }}>{active.answer}</Typography.Paragraph>
            )}

            {active.uiSpec && (
              <Collapse defaultActiveKey={showWidget ? ["widget"] : []} ghost
                onChange={(keys) => setShowWidget(Array.isArray(keys) ? keys.includes("widget") : keys === "widget")}
                items={[{
                  key: "widget", label: "数据视图",
                  children: <UiWidget spec={active.uiSpec} />,
                }]} />
            )}

            {active.citations.length > 0 && (
              <div aria-label="hermes-citations">
                <Typography.Title level={5} style={{ marginTop: 12 }}>引用</Typography.Title>
                <List size="small" dataSource={active.citations} rowKey={(c) => c.nodeId}
                  renderItem={(c) => (
                    <List.Item>
                      <Link to={c.link}>{c.summary}</Link>
                      <Typography.Text type="secondary" style={{ marginLeft: 8 }}>[{c.nodeType}]</Typography.Text>
                    </List.Item>
                  )} />
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
