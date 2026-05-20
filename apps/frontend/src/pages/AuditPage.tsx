import { useCallback, useEffect, useState } from "react";
import { Button, Form, Input, Select, Space, Table, Typography, message } from "antd";
import { api } from "../api.js";
import type { AuditLogEntry } from "@combat/shared";

const ACTION_OPTIONS = ["", "CREATE", "UPDATE", "DELETE", "MERGE", "SCHEMA", "ESCALATE"].map(v => ({
  value: v, label: v || "全部",
}));

function formatChanges(c: unknown): string {
  if (typeof c === "string") return c;
  try { return JSON.stringify(c); } catch { return String(c); }
}

export function AuditPage() {
  const [rows, setRows] = useState<AuditLogEntry[]>([]);
  const [filter, setFilter] = useState<{ action?: string; entityType?: string; entityId?: string }>({});
  const refresh = useCallback(async () => {
    try {
      setRows(await api.listAudit({ ...filter, limit: 100 }));
    } catch (e) { message.error(String((e as Error).message)); }
  }, [filter]);
  useEffect(() => { refresh(); }, [refresh]);

  const columns = [
    { title: "时间", dataIndex: "performedAt", key: "t", width: 200 },
    { title: "操作", dataIndex: "action", key: "a", width: 100 },
    { title: "实体类型", dataIndex: "entityType", key: "et", width: 110 },
    { title: "实体 ID", dataIndex: "entityId", key: "eid", width: 290,
      render: (v: string) => <Typography.Text copyable={{ text: v }} style={{ fontFamily: "monospace", fontSize: 12 }}>{v.slice(0, 12)}…</Typography.Text> },
    { title: "操作人", dataIndex: "performedBy", key: "by", width: 110 },
    { title: "变更", dataIndex: "changes", key: "c",
      render: (c: unknown) => <pre style={{ margin: 0, fontSize: 11, whiteSpace: "pre-wrap" }}>{formatChanges(c)}</pre> },
  ];

  return (
    <div style={{ padding: 16 }}>
      <Typography.Title level={3}>审计日志</Typography.Title>
      <Form layout="inline" style={{ marginBottom: 12 }} aria-label="audit-filter"
        onFinish={(v) => setFilter({ action: v.action || undefined, entityType: v.entityType || undefined, entityId: v.entityId || undefined })}>
        <Form.Item label="操作" name="action">
          <Select aria-label="audit-action" options={ACTION_OPTIONS} style={{ width: 130 }} allowClear />
        </Form.Item>
        <Form.Item label="实体类型" name="entityType">
          <Input aria-label="audit-entity-type" placeholder="如 node / schema" style={{ width: 150 }} allowClear />
        </Form.Item>
        <Form.Item label="实体 ID" name="entityId">
          <Input aria-label="audit-entity-id" placeholder="精确匹配" style={{ width: 200 }} allowClear />
        </Form.Item>
        <Form.Item>
          <Space>
            <Button type="primary" htmlType="submit">查询</Button>
            <Button onClick={() => { setFilter({}); }}>重置</Button>
          </Space>
        </Form.Item>
      </Form>
      <Table rowKey="id" dataSource={rows} columns={columns} pagination={false}
        locale={{ emptyText: "暂无审计记录" }} size="small" />
    </div>
  );
}
