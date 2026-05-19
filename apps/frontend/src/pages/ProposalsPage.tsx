import { useEffect, useState, useCallback } from "react";
import { Table, Button, Space, message, Typography } from "antd";
import { api } from "../api.js";
import type { RelationProposal } from "@combat/shared";

export function ProposalsPage() {
  const [rows, setRows] = useState<RelationProposal[]>([]);
  const refresh = useCallback(async () => {
    setRows(await api.listProposals("待审批"));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const scan = async () => {
    try { const r = await api.scanProposals(); message.success(`扫描完成，新增 ${r.created} 条候选`); await refresh(); }
    catch (e) { message.error(String((e as Error).message)); }
  };
  const decide = async (id: string, decision: string) => {
    try { await api.decideProposal(id, decision, "运营"); message.success(`已${decision}`); await refresh(); }
    catch (e) { message.error(String((e as Error).message)); }
  };

  const columns = [
    { title: "来源实体", dataIndex: "sourceNodeId" },
    { title: "目标实体", dataIndex: "targetNodeId" },
    { title: "关系", dataIndex: "relationType" },
    { title: "置信度", dataIndex: "confidence" },
    { title: "理由", dataIndex: "rationale" },
    { title: "创建时间", dataIndex: "createdAt" },
    { title: "操作", dataIndex: "__act",
      render: (_: unknown, p: RelationProposal) => (
        <Space>
          <Button aria-label={`approve-${p.id}`} type="primary" onClick={() => decide(p.id, "通过")}>通过</Button>
          <Button aria-label={`reject-${p.id}`} danger onClick={() => decide(p.id, "拒绝")}>拒绝</Button>
        </Space>
      ) },
  ];
  return (
    <div style={{ padding: 16 }}>
      <Typography.Title level={3}>关系审批队列</Typography.Title>
      <Button aria-label="scan-proposals" type="primary" onClick={scan} style={{ marginBottom: 12 }}>扫描候选</Button>
      {rows.length === 0 && <p role="status">暂无待审批候选</p>}
      <Table rowKey="id" columns={columns} pagination={false} dataSource={rows} />
    </div>
  );
}
