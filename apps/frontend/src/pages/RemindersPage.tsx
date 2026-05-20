import { useEffect, useState, useCallback } from "react";
import { Table, Button, Space, message, Typography } from "antd";
import { api } from "../api.js";
import type { Reminder } from "@combat/shared";

export function RemindersPage() {
  const [rows, setRows] = useState<Reminder[]>([]);
  const refresh = useCallback(async () => {
    try { setRows(await api.listReminders("待发送")); }
    catch (e) { message.error(String((e as Error).message)); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const scan = async () => {
    try { const r = await api.scanReminders(); message.success(`扫描完成，新增 ${r.created} 条提醒`); await refresh(); }
    catch (e) { message.error(String((e as Error).message)); }
  };
  const send = async (id: string) => {
    try { await api.sendReminder(id, "运营"); message.success("已发送（stub）"); await refresh(); }
    catch (e) { message.error(String((e as Error).message)); }
  };
  const ignore = async (id: string) => {
    try { await api.ignoreReminder(id, "运营"); message.success("已忽略"); await refresh(); }
    catch (e) { message.error(String((e as Error).message)); }
  };

  const columns = [
    { title: "类型", dataIndex: "kind" },
    { title: "攻关单", dataIndex: "ticketId" },
    { title: "收件人", dataIndex: "recipientName" },
    { title: "主题", dataIndex: "subject" },
    { title: "正文", dataIndex: "body" },
    { title: "创建时间", dataIndex: "createdAt" },
    { title: "操作", dataIndex: "__act",
      render: (_: unknown, r: Reminder) => (
        <Space>
          <Button aria-label={`send-${r.id}`} type="primary" onClick={() => send(r.id)}>发送(stub)</Button>
          <Button aria-label={`ignore-${r.id}`} danger onClick={() => ignore(r.id)}>忽略</Button>
        </Space>
      ) },
  ];
  return (
    <div style={{ padding: 16 }}>
      <Typography.Title level={3}>跟催/提醒队列</Typography.Title>
      <Typography.Paragraph type="secondary">
        当前为 stub 渠道：点「发送(stub)」仅记录已发送并写审计，不真实外发。接入 SMTP/eSpace/welink 后真实发送。
      </Typography.Paragraph>
      <Button aria-label="scan-reminders" type="primary" onClick={scan} style={{ marginBottom: 12 }}>扫描提醒</Button>
      {rows.length === 0
        ? <p role="status">暂无待发送提醒</p>
        : <Table rowKey="id" columns={columns} pagination={false} dataSource={rows} />}
    </div>
  );
}
