import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { Descriptions, Timeline, Input, Button, message, List } from "antd";
import { api } from "../api.js";
import type { GraphNode, ProgressLog, HelperRecommendation } from "@combat/shared";

export function AttackDetail() {
  const { id = "" } = useParams();
  const [node, setNode] = useState<GraphNode | null>(null);
  const [seq, setSeq] = useState<ProgressLog[]>([]);
  const [text, setText] = useState("");
  const [helpers, setHelpers] = useState<HelperRecommendation[] | null>(null);
  const refresh = useCallback(() => {
    api.getNode(id).then(setNode);
    api.listProgress(id).then(setSeq);
    api.recommendHelpers(id).then(setHelpers)
      .catch(() => { setHelpers([]); message.error("找帮手加载失败"); });
  }, [id]);
  useEffect(() => { refresh(); }, [refresh]);
  const add = async () => {
    if (!text) return;
    await api.appendProgress(id, text, String(node?.properties["状态"] ?? ""));
    setText(""); message.success("已追加进展"); refresh();
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
      <h3 style={{ marginTop: 24 }}>进展序列</h3>
      <Input.TextArea aria-label="progress-input" value={text}
        onChange={e => setText(e.target.value)} rows={2} />
      <Button type="primary" onClick={add} style={{ margin: "8px 0" }}>追加进展</Button>
      <Timeline items={[...seq].reverse().map(p => ({ children: `#${p.seqNo} [${p.statusSnapshot}] ${p.content}` }))} />
    </div>
  );
}
