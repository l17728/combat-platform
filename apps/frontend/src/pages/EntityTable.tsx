import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { Table, Input, Button, Space, Popconfirm, message, Modal, Select, Segmented, Card, Row, Col, Typography } from "antd";
import { api } from "../api.js";
import type { GraphNode, NodeSchema, FieldSchema } from "@combat/shared";

// §47: pick a human title field for card layout (first required string, then common names).
function titleField(fields: FieldSchema[]): string | undefined {
  const req = fields.find(f => f.required && f.type === "string");
  if (req) return req.id;
  return (fields.find(f => ["标题", "name", "组名", "经验", "告警问题", "事件标题", "事项描述", "问题说明"].includes(f.id)) ?? fields[0])?.id;
}

function RefCell({ nodeType, rowId, fieldId, value }: { nodeType: string; rowId: string; fieldId: string; value: string }) {
  const [to, setTo] = useState(`/related/${nodeType}/${rowId}`);
  useEffect(() => {
    let alive = true;
    api.getRelated(nodeType, rowId).then(d => {
      if (!alive) return; // guard stale/out-of-order resolve after refresh/unmount
      const hit = d.outgoing.find(o => o.field === fieldId);
      if (hit) setTo(hit.node.nodeType === "attackTicket"
        ? `/attack/${hit.node.id}` : `/related/${hit.node.nodeType}/${hit.node.id}`);
    }).catch(() => {});
    return () => { alive = false; };
  }, [nodeType, rowId, fieldId]);
  return <Link aria-label={`ref-${fieldId}`} to={to}>{value}</Link>;
}

export function EntityTable({ nodeType, filterField, linkField, linkTo }: {
  nodeType: string; filterField?: string;
  linkField?: string; linkTo?: (id: string) => string;
}) {
  const [schema, setSchema] = useState<NodeSchema | null>(null);
  const [rows, setRows] = useState<GraphNode[]>([]);
  const [editing, setEditing] = useState<Record<string, Record<string, string>>>({});
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [nf, setNf] = useState({ name: "", label: "", type: "string" });
  const [rn, setRn] = useState<{ id: string; label: string } | null>(null);
  const [al, setAl] = useState<{ id: string; text: string } | null>(null);
  const [cp, setCp] = useState<{ id: string; text: string } | null>(null);
  const [an, setAn] = useState<{ id: string; text: string } | null>(null);
  const [filter, setFilter] = useState("");
  const [viewMode, setViewMode] = useState<"表格" | "卡片">("表格");

  const activeFields = (s: NodeSchema | null): FieldSchema[] => (s?.fields ?? []).filter(f => !f.retired);
  const refresh = useCallback(async () => {
    setFilter("");
    try {
      setSchema(await api.getSchema(nodeType));
      setRows(await api.listNodes(nodeType));
    } catch (e) { message.error(`加载失败：${String((e as Error).message)}`); }
  }, [nodeType]);
  useEffect(() => { refresh(); }, [refresh]);

  const saveRow = async (r: GraphNode) => {
    try { await api.updateNode(r.id, editing[r.id]); message.success("已保存");
      setEditing(e => { const n = { ...e }; delete n[r.id]; return n; }); await refresh(); }
    catch (err) { message.error(String((err as Error).message)); }
  };
  const delRow = async (id: string) => {
    try { await api.deleteNode(id); message.success("已删除"); await refresh(); }
    catch (err) { message.error(String((err as Error).message)); }
  };
  const createDraft = async () => {
    try { await api.createNode(nodeType, draft ?? {}); message.success("已新增"); setDraft(null); await refresh(); }
    catch (err) { message.error(String((err as Error).message)); }
  };
  const patch = async (op: Parameters<typeof api.patchSchema>[1]) => {
    try { await api.patchSchema(nodeType, op); message.success("字段已更新"); await refresh(); }
    catch (err) { message.error(String((err as Error).message)); }
  };

  const fields = activeFields(schema);
  const columns = [
    ...fields.map(f => ({
      title: (
        <Space size={4}>
          <span>{f.label}</span>
          <Button aria-label={`rename-${f.id}`} size="small" type="link" onClick={() => setRn({ id: f.id, label: f.label })}>改名</Button>
          <Popconfirm title={`退休字段「${f.label}」？数据保留`} okText="OK" onConfirm={() => patch({ op: "retire", id: f.id })}>
            <Button aria-label={`retire-${f.id}`} size="small" type="link" danger>退休</Button>
          </Popconfirm>
          <Button aria-label={`aliases-${f.id}`} size="small" type="link"
            onClick={() => setAl({ id: f.id, text: (f.aliases ?? []).join("\n") })}>别名</Button>
          <Button aria-label={`concept-${f.id}`} size="small" type="link"
            onClick={() => setCp({ id: f.id, text: f.concept ?? "" })}>概念</Button>
          <Button aria-label={`anchor-${f.id}`} size="small" type="link"
            onClick={() => setAn({ id: f.id, text: f.anchor ?? "" })}>锚点</Button>
        </Space>
      ),
      dataIndex: f.id,
      render: (_: unknown, r: GraphNode) => {
        const e = editing[r.id];
        if (e) return <Input aria-label={`edit-${f.id}`} value={e[f.id] ?? String(r.properties[f.id] ?? "")}
          onChange={ev => setEditing(s => ({ ...s, [r.id]: { ...s[r.id], [f.id]: ev.target.value } }))} />;
        const val = String(r.properties[f.id] ?? "");
        if (linkField && linkTo && f.id === linkField) return <Link to={linkTo(r.id)}>{val}</Link>;
        if (f.type === "ref") return <RefCell nodeType={nodeType} rowId={r.id} fieldId={f.id} value={val} />;
        return val;
      },
    })),
    {
      title: <Button aria-label="add-field" onClick={() => setAddOpen(true)}>+字段</Button>,
      dataIndex: "__act",
      render: (_: unknown, r: GraphNode) => editing[r.id]
        ? <Space><Button aria-label={`save-${r.id}`} type="primary" onClick={() => saveRow(r)}>保存</Button></Space>
        : <Space>
            <Button aria-label={`edit-row-${r.id}`} onClick={() => setEditing(s => ({ ...s, [r.id]: {} }))}>编辑</Button>
            <Popconfirm title="删除该记录？" okText="OK" onConfirm={() => delRow(r.id)}>
              <Button aria-label={`del-row-${r.id}`} danger>删除</Button>
            </Popconfirm>
          </Space>,
    },
  ];
  const data = filterField
    ? rows.filter(r => !filter || String(r.properties[filterField] ?? "").includes(filter))
    : rows;

  return (
    <div style={{ padding: 16 }}>
      <h2>{schema?.label ?? nodeType}（可编辑）</h2>
      <Segmented aria-label="view-mode" value={viewMode} onChange={(v) => setViewMode(v as "表格" | "卡片")}
        options={["表格", "卡片"]} style={{ marginBottom: 12, marginRight: 12 }} />
      {filterField && <Input.Search aria-label="status-filter" placeholder={`按${filterField}过滤`} allowClear
        onSearch={setFilter} style={{ width: 220, marginBottom: 12 }} />}
      <Space style={{ marginBottom: 12 }}>
        <a aria-label="export-excel" href={`/api/export/${nodeType}`} download
           style={{ marginRight: 8 }}>
          <Button>导出 Excel</Button>
        </a>
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
      {viewMode === "表格" ? (
        <Table rowKey="id" columns={columns} pagination={false} dataSource={data} />
      ) : (
        <Row gutter={[16, 16]} aria-label="card-grid">
          {data.length === 0 && <Col span={24}><Typography.Text type="secondary">暂无数据</Typography.Text></Col>}
          {data.map(r => {
            const tf = titleField(fields);
            const title = tf ? String(r.properties[tf] ?? r.id) : r.id;
            return (
              <Col span={8} key={r.id}>
                <Card aria-label="entity-card" title={title} size="small"
                  extra={<Popconfirm title="删除该记录？" okText="OK" onConfirm={() => delRow(r.id)}>
                    <Button aria-label={`card-del-${r.id}`} size="small" danger>删除</Button>
                  </Popconfirm>}>
                  {fields.filter(f => f.id !== tf && String(r.properties[f.id] ?? "") !== "").map(f => (
                    <div key={f.id} style={{ marginBottom: 4 }}>
                      <Typography.Text type="secondary">{f.label}：</Typography.Text>
                      {f.type === "ref"
                        ? <RefCell nodeType={nodeType} rowId={r.id} fieldId={f.id} value={String(r.properties[f.id])} />
                        : <span>{String(r.properties[f.id])}</span>}
                    </div>
                  ))}
                  <Link to={`/related/${nodeType}/${r.id}`} aria-label={`card-related-${r.id}`}>关联全景</Link>
                </Card>
              </Col>
            );
          })}
        </Row>
      )}
      <Modal title="新增字段" open={addOpen} okText="添加" onCancel={() => setAddOpen(false)}
        onOk={async () => { await patch({ op: "addField", field: { name: nf.name, label: nf.label || nf.name, type: nf.type as FieldSchema["type"] } }); setAddOpen(false); setNf({ name: "", label: "", type: "string" }); }}>
        <Space direction="vertical" style={{ width: "100%" }}>
          <Input aria-label="nf-name" placeholder="字段名(name)" value={nf.name} onChange={e => setNf(s => ({ ...s, name: e.target.value }))} />
          <Input aria-label="nf-label" placeholder="显示名(label)" value={nf.label} onChange={e => setNf(s => ({ ...s, label: e.target.value }))} />
          <Select aria-label="nf-type" value={nf.type} style={{ width: 160 }}
            onChange={v => setNf(s => ({ ...s, type: v }))}
            options={["string", "number", "date", "datetime", "enum"].map(t => ({ value: t, label: t }))} />
        </Space>
      </Modal>
      <Modal title="重命名字段" open={rn !== null} okText="确定" onCancel={() => setRn(null)}
        onOk={async () => { if (rn) await patch({ op: "renameLabel", id: rn.id, label: rn.label }); setRn(null); }}>
        <Input aria-label="rename-input" value={rn?.label ?? ""}
          onChange={e => setRn(s => (s ? { ...s, label: e.target.value } : s))} />
      </Modal>
      <Modal title="编辑别名（每行/逗号一个）" open={al !== null} okText="确定" onCancel={() => setAl(null)}
        onOk={async () => {
          if (al) {
            const aliases = al.text.split(/[\n,]/).map(s => s.trim()).filter(Boolean);
            await patch({ op: "setAliases", id: al.id, aliases });
          }
          setAl(null);
        }}>
        <Input.TextArea aria-label="aliases-input" rows={4} value={al?.text ?? ""}
          onChange={e => setAl(s => (s ? { ...s, text: e.target.value } : s))} />
      </Modal>
      <Modal title="编辑语义概念" open={cp !== null} okText="确定" onCancel={() => setCp(null)}
        onOk={async () => {
          if (cp) await patch({ op: "setConcept", id: cp.id, concept: cp.text.trim() });
          setCp(null);
        }}>
        <Input aria-label="concept-input" value={cp?.text ?? ""}
          onChange={e => setCp(s => (s ? { ...s, text: e.target.value } : s))} />
      </Modal>
      <Modal title="编辑锚点" open={an !== null} okText="确定" onCancel={() => setAn(null)}
        onOk={async () => {
          if (an) await patch({ op: "setAnchor", id: an.id, anchor: an.text.trim() });
          setAn(null);
        }}>
        <Input aria-label="anchor-input" value={an?.text ?? ""}
          onChange={e => setAn(s => (s ? { ...s, text: e.target.value } : s))} />
      </Modal>
    </div>
  );
}
