import { useState } from "react";
import { Button, Card, Input, List, Tag, Typography, message } from "antd";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import type { HermesAnswer, HermesIntent } from "@combat/shared";

const INTENT_LABEL: Record<HermesIntent, string> = {
  status: "进展",
  owner: "负责人",
  "ticket-by-pb": "问题单关联",
  "person-workload": "人员负载",
  "fallback-search": "全文检索",
};
const INTENT_COLOR: Record<HermesIntent, string> = {
  status: "blue",
  owner: "geekblue",
  "ticket-by-pb": "purple",
  "person-workload: ": "magenta",
  "fallback-search": "default",
} as Record<HermesIntent, string>;

const PLACEHOLDER = "示例：\n· PB-12345 涉及哪些单？\n· 断网攻关 谁负责？\n· 数据迁移攻关 现在状态\n· 谁现在最忙？";

export function HermesPage() {
  const [q, setQ] = useState("");
  const [history, setHistory] = useState<HermesAnswer[]>([]);
  const [active, setActive] = useState<HermesAnswer | null>(null);
  const [loading, setLoading] = useState(false);

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

  return (
    <div style={{ padding: 16, display: "grid", gridTemplateColumns: "260px 1fr", gap: 16 }}>
      <div>
        <Typography.Title level={5}>历史问题</Typography.Title>
        <List size="small" dataSource={history} locale={{ emptyText: "暂无历史" }}
          rowKey={(h) => h.question + h.intent}
          renderItem={(h) => (
            <List.Item style={{ cursor: "pointer" }} onClick={() => setActive(h)}>
              <Typography.Text ellipsis>{h.question}</Typography.Text>
            </List.Item>
          )} />
      </div>
      <div>
        <Typography.Title level={3} style={{ marginTop: 0 }}>Hermes 问答（只读 MVP）</Typography.Title>
        <Input.TextArea aria-label="hermes-question" rows={3} value={q} placeholder={PLACEHOLDER}
          onChange={(e) => setQ(e.target.value)} onPressEnter={(e) => { if (!e.shiftKey) { e.preventDefault(); ask(); } }} />
        <div style={{ marginTop: 8, marginBottom: 16 }}>
          <Button type="primary" loading={loading} onClick={ask}>提问</Button>
          <Typography.Text type="secondary" style={{ marginLeft: 12 }}>Enter 提交 · Shift+Enter 换行</Typography.Text>
        </div>
        {active && (
          <Card aria-label="hermes-answer" title={
            <span>
              <Tag color={INTENT_COLOR[active.intent] ?? "default"}>{INTENT_LABEL[active.intent] ?? active.intent}</Tag>
              <span style={{ marginLeft: 8 }}>{active.question}</span>
            </span>
          }>
            <Typography.Paragraph style={{ whiteSpace: "pre-line" }}>{active.answer}</Typography.Paragraph>
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
