import { useEffect, useState, useCallback } from 'react';
import { Table, Tag, Space, Button, Empty, Spin, Card, Row, Col, Typography } from 'antd';
import { ReloadOutlined, NotificationOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api, type TicketTab } from '../api.js';
import { LINKABLE_NODE_TYPES, NODE_TYPE_LABEL, INFO_CATEGORY_COLOR } from '../constants.js';
import type { GraphNode } from '@combat/shared';

const { Text } = Typography;

interface Props {
  ticketId: string;
  tab: TicketTab;
  onDeleted: (tabId: string) => void;
}

export default function DynamicLinkTab({ ticketId, tab }: Props) {
  const navigate = useNavigate();
  const config = JSON.parse(tab.config || '{}');
  const posterCardIds: string[] = Array.isArray(config.posterCardIds) ? config.posterCardIds : [];
  const isPoster = posterCardIds.length > 0;
  const nodeType = config.nodeType || '';
  const label = LINKABLE_NODE_TYPES[nodeType] || NODE_TYPE_LABEL[nodeType] || nodeType || '关联数据';

  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [cards, setCards] = useState<GraphNode[]>([]);
  const [loading, setLoading] = useState(true);

  const posterKey = posterCardIds.join(',');
  const fetchPoster = useCallback(async () => {
    setLoading(true);
    try {
      const all = await api.listNodes('infoCard');
      const byId = new Map(all.map(c => [c.id, c]));
      setCards(posterCardIds.map(id => byId.get(id)).filter((c): c is GraphNode => !!c));
    } catch {
      setCards([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posterKey]);

  const fetchNodes = useCallback(async () => {
    if (!nodeType) { setNodes([]); setLoading(false); return; }
    setLoading(true);
    try {
      const related = await api.getRelated('attackTicket', ticketId, { depth: 1 });
      const allItems = [...related.outgoing, ...related.incoming];
      setNodes(allItems.filter(item => item.node?.nodeType === nodeType).map(f => f.node).filter((n): n is GraphNode => !!n));
    } catch {
      setNodes([]);
    } finally {
      setLoading(false);
    }
  }, [ticketId, nodeType]);

  useEffect(() => { if (isPoster) fetchPoster(); else fetchNodes(); }, [isPoster, fetchPoster, fetchNodes]);

  if (loading) return <Spin style={{ display: 'block', marginTop: 40 }} />;

  if (isPoster) {
    return (
      <div style={{ padding: '16px 0' }}>
        <div style={{ marginBottom: 12 }}>
          <Space>
            <Tag color="gold">全局广场海报</Tag>
            <Button size="small" icon={<NotificationOutlined />} onClick={() => navigate('/?tab=square')}>前往信息广场</Button>
            <Button size="small" icon={<ReloadOutlined />} onClick={fetchPoster}>刷新</Button>
          </Space>
        </div>
        {cards.length === 0 ? (
          <Empty description="暂无关联的信息广场卡片" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Row gutter={[16, 16]}>
            {cards.map(c => {
              const p = c.properties;
              return (
                <Col xs={24} sm={12} key={c.id}>
                  <Card size="small" hoverable onClick={() => navigate('/?tab=square')}
                    title={<Space size={6}><Tag color={INFO_CATEGORY_COLOR[String(p['信息分类'] ?? '')] ?? 'default'}>{String(p['信息分类'] ?? '')}</Tag><Text strong ellipsis>{String(p['标题'] ?? '-')}</Text></Space>}>
                    <div><Text type="secondary">{(String(p['摘要'] ?? p['内容'] ?? '').slice(0, 80)) || '—'}</Text></div>
                    <div style={{ marginTop: 6 }}>
                      <Tag>{String(p['重要程度'] ?? '-')}</Tag>
                      <Text type="secondary" style={{ fontSize: 12 }}>发布人：{String(p['发布人'] ?? '-')}</Text>
                    </div>
                  </Card>
                </Col>
              );
            })}
          </Row>
        )}
      </div>
    );
  }

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
