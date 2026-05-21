import { useCallback, useEffect, useState } from "react";
import { Button, Table, Input, InputNumber, Space, Typography, message } from "antd";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import type { EscalationRule, AuditLogEntry } from "@combat/shared";

export function EscalationPage() {
  const [rules, setRules] = useState<EscalationRule[]>([]);
  const [escalated, setEscalated] = useState<AuditLogEntry[]>([]);

  const load = useCallback(async () => {
    try {
      setRules((await api.getEscalationConfig()).rules);
      setEscalated(await api.listAudit({ action: "ESCALATE", limit: 50 }));
    } catch (e) { message.error(String((e as Error).message)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    try { await api.putEscalationConfig({ rules }); message.success("责任矩阵已保存"); await load(); }
    catch (e) { message.error(String((e as Error).message)); }
  };
  const scan = async () => {
    try {
      const r = await api.scanEscalation();
      message.success(`扫描完成：超期 ${r.overdue} · 本次上升 ${r.escalated}`);
      await load();
    } catch (e) { message.error(String((e as Error).message)); }
  };
  const setRule = (i: number, patch: Partial<EscalationRule>) =>
    setRules(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div style={{ padding: 16 }}>
      <Typography.Title level={3}>SLA 上升 / 责任矩阵</Typography.Title>
      <Space style={{ marginBottom: 12 }}>
        <Button onClick={() => setRules(rs => [...rs, { 事件级别: "", slaHours: 24, 上升角色: "" }])}>+ 规则</Button>
        <Button type="primary" onClick={save}>保存矩阵</Button>
        <Button aria-label="scan-escalation" danger onClick={scan}>扫描上升</Button>
      </Space>
      <Table aria-label="escalation-rules" rowKey="_k" pagination={false}
        dataSource={rules.map((r, i) => ({ ...r, _k: i }))}
        columns={[
          { title: "事件级别", dataIndex: "事件级别", render: (v: string, _r, i) =>
            <Input aria-label={`rule-level-${i}`} value={v} style={{ width: 100 }} onChange={e => setRule(i, { 事件级别: e.target.value })} /> },
          { title: "SLA 小时", dataIndex: "slaHours", render: (v: number, _r, i) =>
            <InputNumber aria-label={`rule-sla-${i}`} value={v} min={0} onChange={n => setRule(i, { slaHours: Number(n) })} /> },
          { title: "上升角色", dataIndex: "上升角色", render: (v: string, _r, i) =>
            <Input aria-label={`rule-role-${i}`} value={v} style={{ width: 140 }} onChange={e => setRule(i, { 上升角色: e.target.value })} /> },
        ]} />
      <Typography.Title level={5} style={{ marginTop: 24 }}>已上升记录</Typography.Title>
      <Table aria-label="escalated-list" rowKey="id" pagination={false} dataSource={escalated}
        locale={{ emptyText: "暂无上升" }}
        columns={[
          { title: "时间", dataIndex: "performedAt", width: 200 },
          { title: "攻关单", dataIndex: "entityId", render: (id: string) => <Link to={`/attack/${id}`}>{id.slice(0, 10)}…</Link> },
          { title: "详情", dataIndex: "changes", render: (c: unknown) => <span>{JSON.stringify(c)}</span> },
        ]} />
    </div>
  );
}
