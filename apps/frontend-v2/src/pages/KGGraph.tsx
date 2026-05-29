import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Typography, Select, Input, Button, Space, message, Spin, Empty, Tag } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { Graph } from '@antv/g6';
import { api } from '../api.js';
import type { GraphSnapshot } from '@combat/shared';
import { NODE_TYPE_LABEL } from '../constants.js';

const { Title, Text } = Typography;

const NODE_TYPES = [
  { value: 'attackTicket', label: '攻关单' },
  { value: 'person', label: '人员' },
  { value: 'contribution', label: '贡献' },
  { value: 'teamContribution', label: '团队贡献' },
  { value: 'infoCard', label: '信息卡片' },
  { value: 'releasePackage', label: '版本包' },
  { value: 'weightFile', label: '权重文件' },
];

const TYPE_COLORS: Record<string, string> = {
  attackTicket: '#1677ff',
  person: '#52c41a',
  contribution: '#fa8c16',
  teamContribution: '#eb2f96',
  infoCard: '#13c2c2',
  releasePackage: '#722ed1',
  weightFile: '#a0d911',
};

const EDGE_LABELS: Record<string, string> = {
  ASSIGNED_TO: '负责',
  CONTRIBUTED_TO: '贡献于',
  REF: '引用',
  ANCHORED_TO: '锚定',
  CONFLICTS_WITH: '冲突',
  OVERLAPS_WITH: '重叠',
  SAME_AS: '同一',
};

function toG6(snapshot: GraphSnapshot) {
  const nodes = snapshot.nodes.map((n) => ({ id: n.id, data: { label: n.label, nodeType: n.nodeType } }));
  const edges = snapshot.edges.map((e) => ({
    id: `${e.source}->${e.target}:${e.edgeType}`,
    source: e.source,
    target: e.target,
    data: { edgeType: e.edgeType },
  }));
  return { nodes, edges };
}

export default function KGGraph() {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph | null>(null);
  const idsRef = useRef<Set<string>>(new Set());
  const navRef = useRef(navigate);
  navRef.current = navigate;

  const [types, setTypes] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [count, setCount] = useState<{ nodes: number; edges: number }>({ nodes: 0, edges: 0 });

  const fetchAndSet = useCallback(async (graph: Graph) => {
    setLoading(true);
    try {
      const snap = await api.kgGraph({ types: types.length ? types : undefined, q: q.trim() || undefined, limit: 500 });
      const data = toG6(snap);
      idsRef.current = new Set(data.nodes.map((n) => n.id));
      graph.setData(data);
      await graph.render();
      setCount({ nodes: data.nodes.length, edges: data.edges.length });
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [types, q]);

  // drill-down: expand a node's 1-hop neighborhood, merging新节点/边
  const expandNode = useCallback(async (graph: Graph, nodeId: string, nodeType: string) => {
    try {
      const snap = await api.graphSnapshot(nodeType, nodeId, 1);
      const data = toG6(snap);
      const newNodes = data.nodes.filter((n) => !idsRef.current.has(n.id));
      newNodes.forEach((n) => idsRef.current.add(n.id));
      if (newNodes.length) graph.addNodeData(newNodes);
      // addEdgeData 忽略两端不存在的边;此处两端均已在图中
      const existingEdgeIds = new Set(graph.getEdgeData().map((e: any) => e.id));
      const newEdges = data.edges.filter((e) => !existingEdgeIds.has(e.id) && idsRef.current.has(e.source) && idsRef.current.has(e.target));
      if (newEdges.length) graph.addEdgeData(newEdges);
      await graph.render();
      setCount({ nodes: idsRef.current.size, edges: graph.getEdgeData().length });
      if (newNodes.length === 0) message.info('该节点没有更多可展开的关联');
    } catch (e: any) {
      message.error(e.message);
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current || graphRef.current) return;
    const graph = new Graph({
      container: containerRef.current,
      autoResize: true,
      layout: { type: 'd3-force', collide: { radius: 40 }, link: { distance: 120 } },
      node: {
        style: {
          size: 30,
          fill: (d: any) => TYPE_COLORS[d?.data?.nodeType] ?? '#8c8c8c',
          stroke: '#fff',
          lineWidth: 1.5,
          labelText: (d: any) => String(d?.data?.label ?? d?.id ?? ''),
          labelFontSize: 11,
          labelFill: '#333',
          labelPlacement: 'bottom',
          labelBackground: true,
          labelBackgroundFill: 'rgba(255,255,255,0.75)',
        },
      },
      edge: {
        style: {
          stroke: '#bfbfbf',
          endArrow: true,
          labelText: (d: any) => EDGE_LABELS[d?.data?.edgeType] ?? String(d?.data?.edgeType ?? ''),
          labelFontSize: 9,
          labelFill: '#999',
        },
      },
      behaviors: ['zoom-canvas', 'drag-canvas', 'drag-element'],
    });
    graphRef.current = graph;
    graph.on('node:click', (e: any) => {
      const id = e?.target?.id;
      if (!id) return;
      const nd = graph.getNodeData(id) as any;
      const nodeType = nd?.data?.nodeType;
      if (nodeType) expandNode(graph, id, nodeType);
    });
    graph.on('node:dblclick', (e: any) => {
      const id = e?.target?.id;
      if (!id) return;
      const nd = graph.getNodeData(id) as any;
      const nodeType = nd?.data?.nodeType;
      if (nodeType === 'attackTicket') navRef.current(`/attack/${id}`);
      else if (nodeType) navRef.current(`/related/${nodeType}/${id}`);
    });
    fetchAndSet(graph);
    return () => { graph.destroy(); graphRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reload = () => { if (graphRef.current) fetchAndSet(graphRef.current); };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <Title level={4} style={{ margin: 0 }}>知识图谱</Title>
        <Space wrap>
          <Select
            mode="multiple"
            allowClear
            style={{ minWidth: 220 }}
            placeholder="按类型筛选(默认全部)"
            value={types}
            onChange={setTypes}
            options={NODE_TYPES}
            maxTagCount="responsive"
          />
          <Input
            style={{ width: 220 }}
            placeholder="搜索关键词"
            prefix={<SearchOutlined />}
            allowClear
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onPressEnter={reload}
          />
          <Button type="primary" icon={<ReloadOutlined />} onClick={reload} loading={loading}>刷新</Button>
        </Space>
      </div>

      <div style={{ marginBottom: 8 }}>
        <Space size={4} wrap>
          <Text type="secondary">单击节点展开关联(下钻)·双击跳转详情·滚轮缩放·拖拽平移 · 当前 {count.nodes} 节点 / {count.edges} 关系</Text>
          {Object.entries(TYPE_COLORS).filter(([k]) => NODE_TYPE_LABEL[k]).map(([k, c]) => (
            <Tag key={k} color={c}>{NODE_TYPE_LABEL[k] ?? k}</Tag>
          ))}
        </Space>
      </div>

      <Spin spinning={loading}>
        <div style={{ position: 'relative', border: '1px solid #f0f0f0', borderRadius: 8, background: '#fafafa' }}>
          <div ref={containerRef} style={{ width: '100%', height: 'calc(100vh - 240px)', minHeight: 420 }} />
          {!loading && count.nodes === 0 && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Empty description="暂无图谱数据(可调整筛选或先录入数据)" />
            </div>
          )}
        </div>
      </Spin>
    </div>
  );
}
