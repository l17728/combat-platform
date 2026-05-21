import { useCallback, useEffect, useState } from "react";
import { Button, Popconfirm, Select, Space, Typography, Descriptions, message } from "antd";
import { api } from "../api.js";
import type { GraphNode, MergePreview } from "@combat/shared";

function personLabel(n: GraphNode): string {
  const name = String(n.properties["name"] ?? n.id);
  const eid = n.properties["employeeId"];
  return eid ? `${name}（${eid}）` : name;
}

export function MergePage() {
  const [persons, setPersons] = useState<GraphNode[]>([]);
  const [fromId, setFromId] = useState<string | undefined>();
  const [toId, setToId] = useState<string | undefined>();
  const [preview, setPreview] = useState<MergePreview | null>(null);

  const loadPersons = useCallback(async () => {
    try { setPersons(await api.listNodes("person")); }
    catch (e) { message.error(String((e as Error).message)); }
  }, []);
  useEffect(() => { loadPersons(); }, [loadPersons]);

  const doPreview = async () => {
    if (!fromId || !toId) { message.warning("请选择两位人员"); return; }
    try { setPreview(await api.mergePreview(fromId, toId)); }
    catch (e) { message.error(String((e as Error).message)); }
  };
  const doMerge = async () => {
    if (!fromId || !toId) return;
    try {
      await api.mergePerson(fromId, toId);
      message.success("合并完成");
      setFromId(undefined); setToId(undefined); setPreview(null);
      await loadPersons();
    } catch (e) { message.error(String((e as Error).message)); }
  };

  const options = persons.map(p => ({ value: p.id, label: personLabel(p) }));

  return (
    <div style={{ padding: 16, maxWidth: 720 }}>
      <Typography.Title level={3}>人员合并</Typography.Title>
      <Typography.Paragraph type="secondary">
        实体解析手动兜底层：当你确认两位人员是同一人时，将「被合并」方的字段并入「保留」方、迁移其所有关系边，然后删除被合并方。<b style={{ color: "#cf1322" }}>此操作不可逆。</b>
      </Typography.Paragraph>
      <Space direction="vertical" style={{ width: "100%" }} size="middle">
        <Space>
          <span>被合并（消失）：</span>
          <Select aria-label="merge-from" showSearch optionFilterProp="label"
            style={{ width: 240 }} value={fromId} onChange={setFromId} options={options} placeholder="选择人员" />
        </Space>
        <Space>
          <span>保留（规范）：</span>
          <Select aria-label="merge-to" showSearch optionFilterProp="label"
            style={{ width: 240 }} value={toId} onChange={setToId} options={options} placeholder="选择人员" />
        </Space>
        <Space>
          <Button onClick={doPreview}>预览</Button>
          <Popconfirm title="合并不可逆"
            description="被合并方将被删除，其字段与所有关系迁移到保留方。确认合并？"
            okText="确认" cancelText="取消" onConfirm={doMerge}>
            <Button aria-label="merge-confirm" danger disabled={!fromId || !toId}>执行合并</Button>
          </Popconfirm>
        </Space>
        {preview && (
          <Descriptions aria-label="merge-preview" bordered size="small" column={1}>
            <Descriptions.Item label="被合并">{personLabel(preview.from)}</Descriptions.Item>
            <Descriptions.Item label="保留">{personLabel(preview.to)}</Descriptions.Item>
            <Descriptions.Item label="将补充字段">
              {preview.unionedFields.length ? preview.unionedFields.join("、") : "（无）"}
            </Descriptions.Item>
            <Descriptions.Item label="迁移关系边数">{preview.edgesToMigrate}</Descriptions.Item>
          </Descriptions>
        )}
      </Space>
    </div>
  );
}
