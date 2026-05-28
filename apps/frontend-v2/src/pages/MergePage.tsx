import { useCallback, useEffect, useState } from 'react';
import { Typography, Button, Popconfirm, Select, Space, Descriptions, message, Alert, Skeleton, Card, Divider } from 'antd';
import { api } from '../api.js';
import type { GraphNode, MergePreview } from '@combat/shared';
import HelpButton from '../components/HelpButton.js';
import HELP from '../help-content.js';

function personLabel(n: GraphNode): string {
  const name = String(n.properties['姓名'] ?? n.properties['name'] ?? n.id);
  const eid = n.properties['工号'];
  const dept = n.properties['部门'];
  return `${name}${eid ? `（${eid}）` : ''}${dept ? ` ${dept}` : ''}`;
}

export default function MergePage() {
  const [persons, setPersons] = useState<GraphNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [fromId, setFromId] = useState<string | undefined>();
  const [toId, setToId] = useState<string | undefined>();
  const [preview, setPreview] = useState<MergePreview | null>(null);

  const loadPersons = useCallback(async () => {
    try {
      setLoading(true);
      setPersons(await api.listNodes('person'));
    } catch (e: any) { message.error(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadPersons(); }, [loadPersons]);

  const doPreview = async () => {
    if (!fromId || !toId) { message.warning('请选择两位人员'); return; }
    try {
      setPreview(await api.mergePreview(fromId, toId));
    } catch (e: any) { message.error(e.message); }
  };

  const doMerge = async () => {
    if (!fromId || !toId) return;
    try {
      await api.mergePerson(fromId, toId);
      message.success('合并完成');
      setFromId(undefined);
      setToId(undefined);
      setPreview(null);
      await loadPersons();
    } catch (e: any) { message.error(e.message); }
  };

  const options = persons.map(p => ({ value: p.id, label: personLabel(p) }));
  const samePerson = fromId && toId && fromId === toId;

  if (loading) return <Skeleton active paragraph={{ rows: 6 }} />;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Typography.Title level={4} style={{ margin: 0 }}>人员合并</Typography.Title>
          <HelpButton title={HELP.mergePage.title} content={HELP.mergePage.content} />
        </div>
      </div>
      <Alert type="warning" showIcon message="此操作不可逆" description="被合并方的字段与所有关系将迁移到保留方，然后删除被合并方。请谨慎操作。" style={{ marginBottom: 16 }} />
      
      <Card style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div>
            <div style={{ marginBottom: 8, fontWeight: 500 }}>被合并（消失）：</div>
            <Select showSearch optionFilterProp="label" style={{ width: '100%' }} value={fromId} onChange={setFromId} options={options} placeholder="选择被合并人员" />
          </div>
          <div>
            <div style={{ marginBottom: 8, fontWeight: 500 }}>保留（规范）：</div>
            <Select showSearch optionFilterProp="label" style={{ width: '100%' }} value={toId} onChange={setToId} options={options} placeholder="选择保留人员" />
          </div>
          {samePerson && <Alert type="error" message="不能选择同一人员" />}
          <Space>
            <Button onClick={doPreview} disabled={!fromId || !toId || !!samePerson}>预览合并</Button>
            <Popconfirm title="合并不可逆"
              description="被合并方将被删除，其字段与所有关系迁移到保留方。确认合并？"
              okText="确认" cancelText="取消" onConfirm={doMerge}>
              <Button danger disabled={!fromId || !toId || !!samePerson || !preview}>执行合并</Button>
            </Popconfirm>
          </Space>
        </Space>
      </Card>

      {preview && (
        <Card title="合并预览">
          <Descriptions bordered size="small" column={1}>
            <Descriptions.Item label="被合并">{personLabel(preview.from)}</Descriptions.Item>
            <Descriptions.Item label="保留">{personLabel(preview.to)}</Descriptions.Item>
            <Descriptions.Item label="将补充字段">
              {preview.unionedFields.length ? (
                <Space wrap>
                  {preview.unionedFields.map(f => <span key={f} style={{ padding: '2px 8px', background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 4, fontSize: 12 }}>{f}</span>)}
                </Space>
              ) : '（无）'}
            </Descriptions.Item>
            <Descriptions.Item label="迁移关系边数">
              <span style={{ fontWeight: 600 }}>{preview.edgesToMigrate}</span> 条
            </Descriptions.Item>
          </Descriptions>
        </Card>
      )}
    </div>
  );
}
