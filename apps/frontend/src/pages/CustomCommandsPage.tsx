import { useCallback, useEffect, useState } from "react";
import { Button, Card, Input, Modal, Space, Table, Tag, Typography, message } from "antd";
import { api } from "../api.js";
import type { CustomCommand } from "@combat/shared";

export function CustomCommandsPage() {
  const [list, setList] = useState<CustomCommand[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [template, setTemplate] = useState("");
  const [running, setRunning] = useState<CustomCommand | null>(null);
  const [args, setArgs] = useState<Record<string, string>>({});
  const [result, setResult] = useState<string>("");

  const load = useCallback(async () => {
    try { setList(await api.listCommands()); }
    catch (e) { message.error(String((e as Error).message)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    try {
      await api.createCommand({ name, template, description: description || undefined });
      message.success("命令已保存");
      setName(""); setDescription(""); setTemplate("");
      await load();
    } catch (e) { message.error(String((e as Error).message)); }
  };

  const del = async (id: string) => {
    try { await api.deleteCommand(id); await load(); }
    catch (e) { message.error(String((e as Error).message)); }
  };

  const openRun = (c: CustomCommand) => {
    setRunning(c);
    setArgs(Object.fromEntries(c.params.map(p => [p, ""])));
    setResult("");
  };

  const execute = async () => {
    if (!running) return;
    try {
      const { request } = await api.runCommand(running.id, args);
      const out = await api.runRaw(request);
      setResult(JSON.stringify(out, null, 2));
      message.success("执行完成");
    } catch (e) {
      setResult(String((e as Error).message));
      message.error(String((e as Error).message));
    }
  };

  return (
    <div style={{ padding: 16 }}>
      <Typography.Title level={3}>自定义命令</Typography.Title>
      <Typography.Paragraph type="secondary">
        把常用操作封装成带参数的命令模板（用 {"{参数}"} 占位，首词须为已知 CLI 命令，如
        <Typography.Text code>nodes:list attackTicket --状态 {"{状态}"}</Typography.Text>）。点击运行时提示输入参数后执行。
      </Typography.Paragraph>

      <Card size="small" title="新建命令" style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: "100%" }}>
          <Input aria-label="cmd-name" placeholder="命令名称" value={name} onChange={e => setName(e.target.value)} />
          <Input aria-label="cmd-description" placeholder="说明（可选）" value={description} onChange={e => setDescription(e.target.value)} />
          <Input.TextArea aria-label="cmd-template" placeholder="CLI 模板，如 nodes:list attackTicket --状态 {状态}"
            value={template} onChange={e => setTemplate(e.target.value)} rows={2} />
          <Button type="primary" aria-label="cmd-create" onClick={create}>保存命令</Button>
        </Space>
      </Card>

      <Table aria-label="commands-table" rowKey="id" pagination={false} dataSource={list}
        locale={{ emptyText: "暂无自定义命令" }}
        columns={[
          { title: "名称", dataIndex: "name" },
          { title: "说明", dataIndex: "description", render: (d: string) => d || "—" },
          { title: "模板", dataIndex: "template", render: (t: string) => <Typography.Text code>{t}</Typography.Text> },
          { title: "参数", dataIndex: "params", render: (p: string[]) => p.length ? p.map(x => <Tag key={x}>{x}</Tag>) : "—" },
          { title: "操作", render: (_v, c: CustomCommand) => (
            <Space>
              <Button size="small" type="primary" aria-label={`run-${c.name}`} onClick={() => openRun(c)}>运行</Button>
              <Button size="small" danger aria-label={`del-${c.name}`} onClick={() => del(c.id)}>删除</Button>
            </Space>
          ) },
        ]} />

      <Modal open={!!running} title={running ? `运行：${running.name}` : ""} onCancel={() => setRunning(null)}
        okText="执行" okButtonProps={{ "aria-label": "cmd-execute" } as any} onOk={execute}>
        <Space direction="vertical" style={{ width: "100%" }}>
          {running?.params.map(p => (
            <Input key={p} aria-label={`arg-${p}`} addonBefore={p} value={args[p] ?? ""}
              onChange={e => setArgs(a => ({ ...a, [p]: e.target.value }))} />
          ))}
          {running?.params.length === 0 && <Typography.Text type="secondary">该命令无参数，直接执行。</Typography.Text>}
          {result && <pre aria-label="cmd-result" style={{ background: "#f5f5f5", padding: 8, maxHeight: 240, overflow: "auto" }}>{result}</pre>}
        </Space>
      </Modal>
    </div>
  );
}
