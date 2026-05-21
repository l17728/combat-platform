import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { Descriptions, Timeline, Input, Button, message, List, Typography, Select, Space } from "antd";
import { api } from "../api.js";
import type { GraphNode, ProgressLog, HelperRecommendation, AuditLogEntry } from "@combat/shared";
import { ATTACK_STATUSES } from "@combat/shared";

export function AttackDetail() {
  const { id = "" } = useParams();
  const [node, setNode] = useState<GraphNode | null>(null);
  const [seq, setSeq] = useState<ProgressLog[]>([]);
  const [text, setText] = useState("");
  const [helpers, setHelpers] = useState<HelperRecommendation[] | null>(null);
  const [audit, setAudit] = useState<AuditLogEntry[]>([]);
  const refresh = useCallback(() => {
    api.getNode(id).then(setNode).catch(() => message.error("攻关单加载失败"));
    api.listProgress(id).then(setSeq).catch(() => message.error("进展加载失败"));
    api.recommendHelpers(id).then(setHelpers)
      .catch(() => { setHelpers([]); message.error("找帮手加载失败"); });
    api.listAudit({ entityId: id, limit: 30 }).then(setAudit).catch(() => setAudit([]));
  }, [id]);
  useEffect(() => { refresh(); }, [refresh]);
  const add = async () => {
    if (!text) return;
    await api.appendProgress(id, text, String(node?.properties["状态"] ?? ""));
    setText(""); message.success("已追加进展"); refresh();
  };
  const [toStatus, setToStatus] = useState<string | undefined>();
  const [note, setNote] = useState("");
  const doTransition = async () => {
    if (!toStatus) { message.warning("请选择目标状态"); return; }
    try {
      await api.transition(id, toStatus, note || undefined);
      message.success(`已流转到「${toStatus}」`);
      setToStatus(undefined); setNote(""); refresh();
    } catch (e) { message.error(String((e as Error).message)); }
  };
  return (
    <div style={{ padding: 16 }}>
      <h2>{String(node?.properties["标题"] ?? "")}</h2>
      <p><Link to={`/related/attackTicket/${id}`} aria-label="related-link">关联全景</Link></p>
      <div aria-label="find-helpers" style={{ margin: "12px 0" }}>
        <h3 style={{ marginBottom: 8 }}>找帮手</h3>
        {helpers !== null && helpers.length === 0 && <p role="status">暂无可推荐人选</p>}
        {helpers && helpers.length > 0 && (
          <List size="small" dataSource={helpers} rowKey={(h) => h.person.id}
            renderItem={(h) => (
              <List.Item>
                <Link to={`/related/person/${h.person.id}`}>
                  {String(h.person.properties["name"] ?? h.person.id)}
                </Link>
                <span style={{ marginLeft: 8, color: "#888" }}>
                  [{h.score}] {h.reasons.join("；")}
                </span>
              </List.Item>
            )} />
        )}
      </div>
      <Descriptions bordered column={1} size="small">
        {Object.entries(node?.properties ?? {}).map(([k, v]) =>
          <Descriptions.Item key={k} label={k}>{String(v)}</Descriptions.Item>)}
      </Descriptions>
      <div aria-label="transition" style={{ marginTop: 24 }}>
        <h3 style={{ marginBottom: 8 }}>状态流转</h3>
        <Space>
          <Select aria-label="transition-status" placeholder="目标状态" style={{ width: 140 }}
            value={toStatus} onChange={setToStatus}
            options={ATTACK_STATUSES.map(s => ({ value: s, label: s }))} />
          <Input aria-label="transition-note" placeholder="备注（可选）" style={{ width: 280 }}
            value={note} onChange={e => setNote(e.target.value)} />
          <Button type="primary" onClick={doTransition}>流转</Button>
        </Space>
      </div>
      <h3 style={{ marginTop: 24 }}>进展序列</h3>
      <Input.TextArea aria-label="progress-input" value={text}
        onChange={e => setText(e.target.value)} rows={2} />
      <Button type="primary" onClick={add} style={{ margin: "8px 0" }}>追加进展</Button>
      <Timeline items={[...seq].reverse().map(p => ({ children: `#${p.seqNo} [${p.statusSnapshot}] ${p.content}` }))} />
      <div aria-label="audit-section" style={{ marginTop: 24, borderTop: "1px dashed #888", paddingTop: 12 }}>
        <Typography.Title level={5}>审计 ({audit.length})</Typography.Title>
        {audit.length === 0 ? <Typography.Text type="secondary">暂无审计记录</Typography.Text> :
          <List size="small" dataSource={audit} rowKey="id"
            renderItem={(a) => (
              <List.Item>
                <Typography.Text style={{ fontFamily: "monospace", fontSize: 12 }}>
                  [{a.performedAt}] {a.action} by {a.performedBy}：
                  {typeof a.changes === "string" ? a.changes : JSON.stringify(a.changes)}
                </Typography.Text>
              </List.Item>
            )} />
        }
      </div>
    </div>
  );
}
