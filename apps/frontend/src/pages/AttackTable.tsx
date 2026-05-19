import { useEffect, useState, useCallback } from "react";
import { Table, Input, Button, Space, Popconfirm, message, Modal, Select } from "antd";
import { api } from "../api.js";
import type { GraphNode, NodeSchema, FieldSchema } from "@combat/shared";

const NODE = "attackTicket";

export function AttackTable() {
  const [schema, setSchema] = useState<NodeSchema | null>(null);
  const [rows, setRows] = useState<GraphNode[]>([]);
  const [editing, setEditing] = useState<Record<string, Record<string, string>>>({});
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [nf, setNf] = useState({ name: "", label: "", type: "string" });

  const activeFields = (s: NodeSchema | null): FieldSchema[] =>
    (s?.fields ?? []).filter(f => !f.retired);

  const refresh = useCallback(async () => {
    const s = await api.getSchema(NODE); setSchema(s);
    setRows(await api.listNodes(NODE));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const saveRow = async (r: GraphNode) => {
    const patch = editing[r.id];
    try { await api.updateNode(r.id, patch); message.success("已保存");
      setEditing(e => { const n = { ...e }; delete n[r.id]; return n; }); await refresh(); }
    catch (err) { message.error(String((err as Error).message)); }
  };
  const delRow = async (id: string) => {
    try { await api.deleteNode(id); message.success("已删除"); await refresh(); }
    catch (err) { message.error(String((err as Error).message)); }
  };
  const createDraft = async () => {
    try { await api.createNode(NODE, draft ?? {}); message.success("已新增"); setDraft(null); await refresh(); }
    catch (err) { message.error(String((err as Error).message)); }
  };
  const patch = async (op: Parameters<typeof api.patchSchema>[1]) => {
    try { await api.patchSchema(NODE, op); message.success("字段已更新"); await refresh(); }
    catch (err) { message.error(String((err as Error).message)); }
  };

  const fields = activeFields(schema);
  const columns = [
    ...fields.map(f => ({
      title: (
        <Space size={4}>
          <span>{f.label}</span>
          <Button aria-label={`rename-${f.id}`} size="small" type="link" onClick={() => {
            const v = window.prompt(`重命名「${f.label}」`, f.label);
            if (v) patch({ op: "renameLabel", id: f.id, label: v });
          }}>改名</Button>
          <Popconfirm title={`退休字段「${f.label}」？数据保留`} onConfirm={() => patch({ op: "retire", id: f.id })}>
            <Button aria-label={`retire-${f.id}`} size="small" type="link" danger>退休</Button>
          </Popconfirm>
        </Space>
      ),
      dataIndex: f.id,
      render: (_: unknown, r: GraphNode) => {
        const e = editing[r.id];
        if (e) return <Input aria-label={`edit-${f.id}`} value={e[f.id] ?? String(r.properties[f.id] ?? "")}
          onChange={ev => setEditing(s => ({ ...s, [r.id]: { ...s[r.id], [f.id]: ev.target.value } }))} />;
        return String(r.properties[f.id] ?? "");
      },
    })),
    {
      title: <Button aria-label="add-field" onClick={() => setAddOpen(true)}>+字段</Button>,
      dataIndex: "__act",
      render: (_: unknown, r: GraphNode) => editing[r.id]
        ? <Space><Button aria-label={`save-${r.id}`} type="primary" onClick={() => saveRow(r)}>保存</Button></Space>
        : <Space>
            <Button aria-label={`edit-row-${r.id}`} onClick={() => setEditing(s => ({ ...s, [r.id]: {} }))}>编辑</Button>
            <Popconfirm title="删除该记录？" onConfirm={() => delRow(r.id)}>
              <Button aria-label={`del-row-${r.id}`} danger>删除</Button>
            </Popconfirm>
          </Space>,
    },
  ];

  return (
    <div style={{ padding: 16 }}>
      <h2>攻关作战台（可编辑）</h2>
      <Space style={{ marginBottom: 12 }}>
        {draft === null
          ? <Button aria-label="new-row" type="primary" onClick={() => setDraft({})}>新增行</Button>
          : <>
              {fields.map(f => <Input key={f.id} aria-label={`draft-${f.id}`} placeholder={f.label}
                style={{ width: 140 }} value={draft[f.id] ?? ""}
                onChange={e => setDraft(d => ({ ...d, [f.id]: e.target.value }))} />)}
              <Button aria-label="create-row" type="primary" onClick={createDraft}>创建</Button>
              <Button onClick={() => setDraft(null)}>取消</Button>
            </>}
      </Space>
      <Table rowKey="id" dataSource={rows} columns={columns} pagination={false} />
      <Modal title="新增字段" open={addOpen} okText="添加"
        onCancel={() => setAddOpen(false)}
        onOk={async () => { await patch({ op: "addField", field: { name: nf.name, label: nf.label || nf.name, type: nf.type as FieldSchema["type"] } }); setAddOpen(false); setNf({ name: "", label: "", type: "string" }); }}>
        <Space direction="vertical" style={{ width: "100%" }}>
          <Input aria-label="nf-name" placeholder="字段名(name)" value={nf.name} onChange={e => setNf(s => ({ ...s, name: e.target.value }))} />
          <Input aria-label="nf-label" placeholder="显示名(label)" value={nf.label} onChange={e => setNf(s => ({ ...s, label: e.target.value }))} />
          <Select aria-label="nf-type" value={nf.type} style={{ width: 160 }}
            onChange={v => setNf(s => ({ ...s, type: v }))}
            options={["string", "number", "date", "datetime", "enum"].map(t => ({ value: t, label: t }))} />
        </Space>
      </Modal>
    </div>
  );
}
