import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Space, Table, Tabs, Typography, message } from "antd";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import type { ConflictRow, GraphNode, ScanConflictsResult } from "@combat/shared";

function detailLink(n: GraphNode): string {
  return n.nodeType === "attackTicket" ? `/attack/${n.id}` : `/related/${n.nodeType}/${n.id}`;
}
function label(n: GraphNode): string {
  return String(n.properties["标题"] ?? n.properties["name"] ?? n.properties["贡献人"] ?? n.id);
}

export function ConflictsPage() {
  const [rows, setRows] = useState<ConflictRow[]>([]);
  const [scanResult, setScanResult] = useState<ScanConflictsResult | null>(null);

  const refresh = useCallback(async () => {
    try { setRows(await api.listConflicts()); }
    catch (e) { message.error(String((e as Error).message)); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const rescan = async () => {
    try {
      const r = await api.scanConflicts();
      setScanResult(r);
      message.success(`扫描完成：冲突 ${r.conflicts} · 重叠 ${r.overlaps}`);
      await refresh();
    } catch (e) { message.error(String((e as Error).message)); }
  };

  // Counts are derived from the current list so the header is always
  // consistent with what the user sees in the Tabs (scanResult is only used
  // for the post-scan toast message).
  const conflictRows = useMemo(() => rows.filter(r => r.edgeType === "CONFLICTS_WITH"), [rows]);
  const overlapRows = useMemo(() => rows.filter(r => r.edgeType === "OVERLAPS_WITH"), [rows]);
  const n = conflictRows.length;
  const m = overlapRows.length;

  const columns = [
    {
      title: "源节点",
      dataIndex: ["source", "id"],
      key: "source",
      render: (_: unknown, row: ConflictRow) => (
        <Link to={`/related/${row.source.nodeType}/${row.source.id}`}>{label(row.source)}</Link>
      ),
    },
    {
      title: "目标节点",
      dataIndex: ["target", "id"],
      key: "target",
      render: (_: unknown, row: ConflictRow) => (
        <Link to={detailLink(row.target)}>{label(row.target)}</Link>
      ),
    },
    { title: "理由", dataIndex: "reason", key: "reason" },
  ];

  return (
    <div style={{ padding: 16 }}>
      <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 12 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>冲突 / 重叠检测</Typography.Title>
        <Space>
          <Typography.Text aria-label="conflicts-counts" style={{ color: "#cf1322" }}>
            冲突 {n} · 重叠 {m}
          </Typography.Text>
          <Button aria-label="rescan-conflicts" danger onClick={rescan}>重新扫描</Button>
        </Space>
      </Space>
      {scanResult && (
        <Typography.Paragraph type="secondary" style={{ marginTop: -4 }}>
          上次扫描：冲突 {scanResult.conflicts} · 重叠 {scanResult.overlaps}
        </Typography.Paragraph>
      )}
      <Tabs
        defaultActiveKey="conflicts"
        items={[
          {
            key: "conflicts",
            label: `冲突（同负责人） ${n}`,
            children: (
              <Table
                rowKey={(r) => r.source.id + "->" + r.target.id + ":" + r.reason}
                dataSource={conflictRows}
                columns={columns}
                pagination={false}
                locale={{ emptyText: "暂无冲突" }}
              />
            ),
          },
          {
            key: "overlaps",
            label: `重叠（同问题单） ${m}`,
            children: (
              <Table
                rowKey={(r) => r.source.id + "->" + r.target.id + ":" + r.reason}
                dataSource={overlapRows}
                columns={columns}
                pagination={false}
                locale={{ emptyText: "暂无重叠" }}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
