import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { List, Typography, Select, Space } from "antd";
import { api } from "../api.js";
import type { RelatedResult } from "../api.js";
import type { GraphNode } from "@combat/shared";

function detailLink(n: GraphNode): string {
  return n.nodeType === "attackTicket" ? `/attack/${n.id}` : `/related/${n.nodeType}/${n.id}`;
}
function label(n: GraphNode): string {
  return String(n.properties["标题"] ?? n.properties["姓名"] ?? n.properties["name"] ?? n.properties["贡献人"] ?? n.id);
}

export function RelatedPage() {
  const { nodeType = "", id = "" } = useParams();
  const [data, setData] = useState<RelatedResult | null>(null);
  const [depth, setDepth] = useState(1);
  useEffect(() => {
    api.getRelated(nodeType, id, { includeCandidates: true, depth }).then(setData)
      .catch(() => setData({ outgoing: [], incoming: [] }));
  }, [nodeType, id, depth]);
  const all = [
    ...(data?.incoming ?? []).map(x => ({ ...x, dir: "← 引用本节点" })),
    ...(data?.outgoing ?? []).map(x => ({ ...x, dir: "→ 本节点引用" })),
  ];
  const groups: Record<string, typeof all> = {};
  for (const x of all) (groups[x.concept || x.node.nodeType] ??= []).push(x);
  return (
    <div style={{ padding: 16 }}>
      <Typography.Title level={3}>关联全景：{nodeType} / {id}</Typography.Title>
      <Space style={{ marginBottom: 8 }}>
        <Link to={`/graph/${nodeType}/${id}`} aria-label="graph-view-link">📊 图形视图</Link>
      </Space>
      <Space style={{ marginBottom: 12 }}>
        <span>深度：</span>
        <Select aria-label="depth-select" value={depth} onChange={setDepth} style={{ width: 80 }}
          options={[{ value: 1, label: "1" }, { value: 2, label: "2" }, { value: 3, label: "3" }]} />
      </Space>
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
      {data?.coAnchored && data.coAnchored.length > 0 && (
        <div style={{ marginTop: 24, borderTop: "1px dashed #1677ff", paddingTop: 12 }}>
          <Typography.Title level={5} style={{ color: "#1677ff" }}>跨颗粒度（共享锚点）</Typography.Title>
          <List size="small" dataSource={data.coAnchored}
            rowKey={(c) => c.node.id + c.anchorKind + c.anchorKey}
            renderItem={(c) => (
              <List.Item>
                <Link to={detailLink(c.node)}>{label(c.node)}</Link>
                <span style={{ marginLeft: 8, color: "#1677ff" }}>[{c.anchorKind}:{c.anchorKey}]</span>
              </List.Item>
            )} />
        </div>
      )}
      {data?.expanded && data.expanded.length > 0 && (
        <div style={{ marginTop: 24, borderTop: "1px dashed #389e0d", paddingTop: 12 }} aria-label="expanded-panel">
          <Typography.Title level={5} style={{ color: "#389e0d" }}>扩展（深度 {depth}）</Typography.Title>
          <List size="small" dataSource={data.expanded}
            rowKey={(x) => x.node.id + x.depth + x.viaEdgeType + x.viaField}
            renderItem={(x) => (
              <List.Item>
                <Link to={detailLink(x.node)}>{label(x.node)}</Link>
                <span style={{ marginLeft: 8, color: "#389e0d" }}>
                  [深度 {x.depth} · {x.viaEdgeType}{x.viaField ? ` · ${x.viaField}` : ""}]
                </span>
              </List.Item>
            )} />
        </div>
      )}
      {data?.conflicts && data.conflicts.length > 0 && (
        <div aria-label="conflicts-panel" style={{ marginTop: 24, borderTop: "2px dashed #cf1322", paddingTop: 12 }}>
          <Typography.Title level={5} style={{ color: "#cf1322" }}>冲突 / 重叠</Typography.Title>
          <List size="small" dataSource={data.conflicts}
            rowKey={(c) => c.node.id + c.edgeType + c.reason}
            renderItem={(c) => (
              <List.Item>
                <Link to={detailLink(c.node)}>{label(c.node)}</Link>
                <span style={{ marginLeft: 8, color: "#cf1322" }}>
                  [{c.edgeType === "CONFLICTS_WITH" ? "冲突" : "重叠"} · {c.reason}]
                </span>
              </List.Item>
            )} />
        </div>
      )}
    </div>
  );
}
