import { useEffect, useState, useCallback } from 'react';
import { Table, Tag, Space, Button, Empty, Spin } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { api, type TicketTab } from '../api.js';
import { LINKABLE_NODE_TYPES, NODE_TYPE_LABEL } from '../constants.js';
import type { GraphNode } from '@combat/shared';

interface Props {
  ticketId: string;
  tab: TicketTab;
  onDeleted: (tabId: string) => void;
}

export default function DynamicLinkTab({ ticketId, tab, onDeleted }: Props) {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [loading, setLoading] = useState(true);

  const config = JSON.parse(tab.config || '{}');
  const nodeType = config.nodeType || '';
  const label = LINKABLE_NODE_TYPES[nodeType] || NODE_TYPE_LABEL[nodeType] || nodeType || '关联数据';

  const fetchNodes = useCallback(async () => {
    if (!nodeType) { setNodes([]); setLoading(false); return; }
    setLoading(true);
    try {
      const related = await api.getRelated('attackTicket', ticketId, { depth: 1 });
      const allItems = [...related.outgoing, ...related.incoming];
      const filtered = nodeType
        ? allItems.filter(item => item.node?.nodeType === nodeType)
        : allItems;
      setNodes(filtered.map(f => f.node).filter((n): n is GraphNode => !!n));
    } catch {
      setNodes([]);
    } finally {
      setLoading(false);
    }
  }, [ticketId, nodeType]);

  useEffect(() => { fetchNodes(); }, [fetchNodes]);

  if (loading) return <Spin style={{ display: 'block', marginTop: 40 }} />;

  const columns = [
    {
      title: '名称', dataIndex: 'name', render: (_: unknown, n: GraphNode) => {
        const name = n.properties['标题'] || n.properties['姓名'] || n.properties['name'] || n.id.slice(0, 8);
        return String(name);
      },
    },
    { title: '类型', dataIndex: 'nodeType', width: 120, render: (v: string) => <Tag>{NODE_TYPE_LABEL[v] || v}</Tag> },
  ];

  return (
    <div style={{ padding: '16px 0' }}>
      <div style={{ marginBottom: 12 }}>
        <Space>
          <Tag color="blue">{label}</Tag>
          <Button size="small" icon={<ReloadOutlined />} onClick={fetchNodes}>刷新</Button>
        </Space>
      </div>
      {nodes.length === 0 ? (
        <Empty description={`暂无${label}数据`} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <Table size="small" dataSource={nodes} columns={columns} rowKey="id" pagination={false} />
      )}
    </div>
  );
}
