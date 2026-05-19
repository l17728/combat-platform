import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { List, Typography } from "antd";
import { api } from "../api.js";
import type { RelatedResult } from "../api.js";
import type { GraphNode } from "@combat/shared";

function detailLink(n: GraphNode): string {
  return n.nodeType === "attackTicket" ? `/attack/${n.id}` : `/related/${n.nodeType}/${n.id}`;
}
function label(n: GraphNode): string {
  return String(n.properties["标题"] ?? n.properties["name"] ?? n.properties["贡献人"] ?? n.id);
}

export function RelatedPage() {
  const { nodeType = "", id = "" } = useParams();
  const [data, setData] = useState<RelatedResult | null>(null);
  useEffect(() => {
    api.getRelated(nodeType, id, { includeCandidates: true }).then(setData)
      .catch(() => setData({ outgoing: [], incoming: [] }));
  }, [nodeType, id]);
  const all = [
    ...(data?.incoming ?? []).map(x => ({ ...x, dir: "← 引用本节点" })),
    ...(data?.outgoing ?? []).map(x => ({ ...x, dir: "→ 本节点引用" })),
  ];
  const groups: Record<string, typeof all> = {};
  for (const x of all) (groups[x.concept || x.node.nodeType] ??= []).push(x);
  return (
    <div style={{ padding: 16 }}>
      <Typography.Title level={3}>关联全景：{nodeType} / {id}</Typography.Title>
      {Object.keys(groups).length === 0 && <p role="status">暂无关联</p>}
      {Object.entries(groups).map(([nt, items]) => (
        <div key={nt} style={{ marginBottom: 16 }}>
          <Typography.Title level={5}>{nt}（{items.length}）</Typography.Title>
          <List size="small" dataSource={items} rowKey={(x) => x.node.id + x.field + x.dir}
            renderItem={(x) => (
              <List.Item>
                <Link to={detailLink(x.node)}>{label(x.node)}</Link>
                <span style={{ marginLeft: 8, color: "#888" }}>[{x.field}] {x.dir}</span>
              </List.Item>
            )} />
        </div>
      ))}
      {data?.candidates && data.candidates.length > 0 && (
        <div style={{ marginTop: 24, borderTop: "1px dashed #d46b08", paddingTop: 12 }}>
          <Typography.Title level={5} style={{ color: "#d46b08" }}>候选关系（待审批）</Typography.Title>
          <List size="small" dataSource={data.candidates}
            rowKey={(c) => c.proposalId}
            renderItem={(c) => (
              <List.Item>
                <Link to={detailLink(c.node)}>{label(c.node)}</Link>
                <span style={{ marginLeft: 8, color: "#d46b08" }}>
                  [{c.relationType} {Math.round(c.confidence * 100)}%] {c.rationale}
                </span>
              </List.Item>
            )} />
        </div>
      )}
    </div>
  );
}
