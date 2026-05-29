import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Typography, Select, Input, Button, Space, message, Spin, Empty, Tag } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { Graph } from '@antv/g6';
import { api } from '../api.js';
import type { GraphSnapshot } from '@combat/shared';
import { NODE_TYPE_LABEL } from '../constants.js';
import HermesChat from '../components/HermesChat.js';

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
  const baseIdsRef = useRef<Set<string>>(new Set());      // 基图节点(刷新得来),折叠时永不移除
  const addedByRef = useRef<Map<string, Set<string>>>(new Map()); // 邻居 id → 引入它的展开节点集合(引用计数)
  const expandedRef = useRef<Set<string>>(new Set());     // 当前已展开的节点
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null); // 单击防抖(dblclick 取消)
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
      if (graph.destroyed) return;                    // 组件已卸载,放弃渲染(防 g6 空引用)
      const data = toG6(snap);
      idsRef.current = new Set(data.nodes.map((n) => n.id));
      baseIdsRef.current = new Set(idsRef.current);   // 刷新即重置基图(= 折叠全部)
      addedByRef.current = new Map();
      expandedRef.current = new Set();
      graph.setData(data);
      await graph.render();
      setCount({ nodes: data.nodes.length, edges: data.edges.length });
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [types, q]);

  // 下钻展开:取节点 1 跳邻域并合并新节点/边;记录"谁引入了谁"用于折叠。
  const expandNode = useCallback(async (graph: Graph, nodeId: string, nodeType: string) => {
    try {
      const snap = await api.graphSnapshot(nodeType, nodeId, 1);
      if (graph.destroyed) return;                    // 卸载/导航后放弃
      const data = toG6(snap);
      const newNodes = data.nodes.filter((n) => !idsRef.current.has(n.id));
      // 记录引用计数:本次展开为这些新邻居记上 nodeId(已有节点不计,避免误删基图)
      for (const n of newNodes) {
        if (!addedByRef.current.has(n.id)) addedByRef.current.set(n.id, new Set());
        addedByRef.current.get(n.id)!.add(nodeId);
        idsRef.current.add(n.id);
      }
      if (newNodes.length) graph.addNodeData(newNodes);
      const existingEdgeIds = new Set(graph.getEdgeData().map((e: any) => e.id));
      const newEdges = data.edges.filter((e) => !existingEdgeIds.has(e.id) && idsRef.current.has(e.source) && idsRef.current.has(e.target));
      if (newEdges.length) graph.addEdgeData(newEdges);
      expandedRef.current.add(nodeId);
      await graph.render();
      setCount({ nodes: idsRef.current.size, edges: graph.getEdgeData().length });
      if (newNodes.length === 0) message.info('该节点没有更多可展开的关联(再次单击可折叠)');
    } catch (e: any) {
      message.error(e.message);
    }
  }, []);

  // 折叠:移除本节点引入、且不再被其它展开节点持有、且非基图的邻居(级联清理)。
  const collapseNode = useCallback(async (graph: Graph, nodeId: string) => {
    const toRemove: string[] = [];
    for (const [neighbor, holders] of addedByRef.current) {
      if (!holders.has(nodeId)) continue;
      holders.delete(nodeId);
      if (holders.size === 0 && !baseIdsRef.current.has(neighbor)) toRemove.push(neighbor);
    }
    expandedRef.current.delete(nodeId);
    if (toRemove.length === 0) {
      message.info('该节点的关联已被其它节点共享,无可折叠项');
      return;
    }
    for (const id of toRemove) {
      idsRef.current.delete(id);
      addedByRef.current.delete(id);
      expandedRef.current.delete(id);
    }
    if (graph.destroyed) return;
    try {
      graph.removeNodeData(toRemove); // g6 v5 一并移除其相连边
      await graph.render();
      setCount({ nodes: idsRef.current.size, edges: graph.getEdgeData().length });
    } catch (e: any) {
      message.error(e.message);
    }
  }, []);

  const toggleNode = useCallback((graph: Graph, nodeId: string, nodeType: string) => {
    if (expandedRef.current.has(nodeId)) collapseNode(graph, nodeId);
    else expandNode(graph, nodeId, nodeType);
  }, [expandNode, collapseNode]);

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
    // 单击延迟执行(展开/折叠),双击则取消单击并导航,避免双击同时触发图变更 + 卸载销毁的竞态
    graph.on('node:click', (e: any) => {
      const id = e?.target?.id;
      if (!id) return;
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
      clickTimerRef.current = setTimeout(() => {
        clickTimerRef.current = null;
        if (graph.destroyed) return;
        const nd = graph.getNodeData(id) as any;
        const nodeType = nd?.data?.nodeType;
        if (nodeType) toggleNode(graph, id, nodeType);
      }, 260);
    });
    graph.on('node:dblclick', (e: any) => {
      const id = e?.target?.id;
      if (!id) return;
      if (clickTimerRef.current) { clearTimeout(clickTimerRef.current); clickTimerRef.current = null; }
      const nd = graph.getNodeData(id) as any;
      const nodeType = nd?.data?.nodeType;
      if (nodeType === 'attackTicket') navRef.current(`/attack/${id}`);
      else if (nodeType) navRef.current(`/related/${nodeType}/${id}`);
    });
    fetchAndSet(graph);
    return () => {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
      try { graph.destroy(); } catch { /* ignore double-destroy */ }
      graphRef.current = null;
    };
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
          <Text type="secondary">单击节点展开/折叠关联(下钻/上钻)·双击跳转详情·滚轮缩放·拖拽平移 · 当前 {count.nodes} 节点 / {count.edges} 关系</Text>
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

      <HermesChat title="知识图谱 AI 问答" placeholder="基于知识图谱提问,如:某攻关单谁负责 / 最近变动 / 某人的贡献" />
    </div>
  );
}
