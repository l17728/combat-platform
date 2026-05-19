import { useState } from "react";
import { Input, List, Typography, message } from "antd";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import type { QueryHit } from "@combat/shared";

function detailLink(h: QueryHit): string {
  return h.nodeType === "attackTicket" ? `/attack/${h.id}` : `/related/${h.nodeType}/${h.id}`;
}

export function SearchPage() {
  const [hits, setHits] = useState<QueryHit[] | null>(null);
  const run = async (q: string) => {
    if (!q.trim()) { setHits(null); return; }
    try { setHits(await api.search(q.trim())); }
    catch (e) { message.error(String((e as Error).message)); }
  };
  return (
    <div style={{ padding: 16 }}>
      <Typography.Title level={3}>信息检索</Typography.Title>
      <Input.Search aria-label="query-input" placeholder="检索攻关/贡献/关联信息（Hermes 只读契约）"
        allowClear enterButton onSearch={run} style={{ maxWidth: 480, marginBottom: 12 }} />
      {hits !== null && hits.length === 0 && <p role="status">无匹配结果</p>}
      {hits && hits.length > 0 && (
        <List size="small" dataSource={hits} rowKey={(h) => h.id}
          renderItem={(h) => (
            <List.Item>
              <Link to={detailLink(h)}>{h.summary}</Link>
              <span style={{ marginLeft: 8, color: "#888" }}>（{h.nodeType}）</span>
            </List.Item>
          )} />
      )}
    </div>
  );
}
