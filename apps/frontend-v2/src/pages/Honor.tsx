import { useEffect, useState, useMemo } from 'react';
import { Typography, Card, List, Tag, Skeleton, Empty, Select, Table, Space, Tabs, Button, Descriptions, Row, Col, Divider } from 'antd';
import { TrophyOutlined, ExportOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { CONTRIBUTION_COLOR, PAGE_SIZE, DATE_FORMAT_FULL } from '../constants.js';
import { useFlexTable, FlexHeaderCell } from '../hooks/useFlexTable.js';
import type { LeaderboardEntry, GraphNode } from '@combat/shared';
import StatusTag from '../components/StatusTag.js';
import HelpButton from '../components/HelpButton.js';
import HELP from '../help-content.js';
import dayjs from 'dayjs';
import quarterOfYear from 'dayjs/plugin/quarterOfYear';

dayjs.extend(quarterOfYear);

const { Title, Text } = Typography;

function RankTag({ rank }: { rank: number }) {
  const colors = ['gold', '#c0c0c0', '#cd7f32'];
  const icons = ['🥇', '🥈', '🥉'];
  return <Tag color={colors[rank] ?? 'default'} style={{ fontSize: 14 }}>{icons[rank] ?? `#${rank + 1}`}</Tag>;
}

export default function Honor() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [teamNodes, setTeamNodes] = useState<GraphNode[]>([]);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<string | undefined>();
  const [tab, setTab] = useState('personal');
  const navigate = useNavigate();

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.getLeaderboard(period),
      api.listNodes('teamContribution'),
    ]).then(([personal, team]) => {
      setEntries(personal);
      setTeamNodes(team);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [period]);

  const teamFiltered = useMemo(
    () => teamNodes.filter((n) => !period || String(n.properties['周期'] ?? '') === period),
    [teamNodes, period],
  );

  const teamGroups = useMemo(() => {
    const order = ['核心', '关键', '普通'];
    const seen = new Set<string>(order);
    const levels = [...order];
    for (const n of teamFiltered) {
      const lv = String(n.properties['贡献等级'] ?? '');
      if (lv && !seen.has(lv)) { seen.add(lv); levels.push(lv); }
    }
    return levels
      .map((lv) => ({ level: lv, nodes: teamFiltered.filter((n) => String(n.properties['贡献等级'] ?? '') === lv) }))
      .filter((g) => g.nodes.length > 0);
  }, [teamFiltered]);

  const quarters = (() => {
    const now = dayjs();
    const list: string[] = [];
    for (let i = 0; i < 8; i++) {
      const d = now.subtract(i, 'quarter');
      const q = Math.ceil((d.month() + 1) / 3);
      list.push(`${d.year()}-Q${q}`);
    }
    return list;
  })();

  const handleExport = async () => {
    try {
      const b = await api.exportNodes('contribution');
      const u = URL.createObjectURL(b);
      const a = document.createElement('a');
      a.href = u; a.download = `荣誉排行_${period ?? '全部'}.xlsx`; a.click();
      URL.revokeObjectURL(u);
    } catch {}
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Title level={4} style={{ margin: 0 }}>
            <TrophyOutlined style={{ color: '#faad14', marginRight: 8 }} />
            荣誉殿堂
          </Title>
          <HelpButton title={HELP.honor.title} content={HELP.honor.content} />
        </div>
        <Space>
          <Select placeholder="选择周期" allowClear style={{ width: 140 }} value={period} onChange={setPeriod}
            options={quarters.map((p) => ({ value: p, label: p }))} />
          <Button icon={<ExportOutlined />} onClick={handleExport}>导出数据</Button>
        </Space>
      </div>

      {loading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : entries.length === 0 && teamFiltered.length === 0 ? (
        <Empty description="暂无贡献数据" />
      ) : (
        <Tabs activeKey={tab} onChange={setTab} items={[
          {
            key: 'personal',
            label: '个人排行',
            children: (
              <>
                <Card style={{ marginBottom: 16 }}>
                  <List
                    dataSource={entries.slice(0, 10)}
                    renderItem={(entry, i) => (
                       <List.Item style={{ cursor: 'pointer', padding: '12px 0' }} onClick={() => navigate(`/honor/${encodeURIComponent(entry.贡献人)}`)}>
                        <List.Item.Meta
                          avatar={<RankTag rank={i} />}
                          title={<span>{entry.贡献人}<Text type="secondary" style={{ marginLeft: 12 }}>加权 {entry.score}</Text></span>}
                          description={<Space>{Object.entries(entry.byLevel).map(([level, count]) => (
                            <Tag key={level} color={CONTRIBUTION_COLOR[level] ?? 'default'}>{level} × {count}</Tag>
                          ))}</Space>}
                        />
                      </List.Item>
                    )}
                  />
                </Card>
                <Card title="详细排行">
                  <HonorDetailTable entries={entries} navigate={navigate} />
                </Card>
              </>
            ),
          },
          {
            key: 'team',
            label: '团队荣誉',
            children: teamFiltered.length === 0 ? <Empty description="暂无团队贡献" /> : (
              <Row gutter={16}>
                <Col span={16}>
                  {teamGroups.map((group) => (
                    <div key={group.level}>
                      <Divider orientation="left" orientationMargin={0}>
                        {group.level} · {group.nodes.length}
                      </Divider>
                      <Row gutter={[16, 16]}>
                        {group.nodes.map((node) => (
                          <Col xs={24} sm={12} key={node.id}>
                            <TeamCard node={node} selected={selected?.id === node.id} onSelect={setSelected} />
                          </Col>
                        ))}
                      </Row>
                    </div>
                  ))}
                </Col>
                <Col span={8}>
                  <Card size="small" title="团队详情" style={{ position: 'sticky', top: 0 }}>
                    {selected ? <TeamDetail node={selected} /> : <Empty description="选择左侧团队查看详情" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
                  </Card>
                </Col>
              </Row>
            ),
          },
        ]} />
      )}
    </div>
  );
}

function HonorDetailTable({ entries, navigate }: { entries: LeaderboardEntry[]; navigate: (path: string) => void }) {
  const columns = [
    { key: '名次', title: '名次', width: 60, render: (_: unknown, __: unknown, i: number) => <RankTag rank={i} /> },
    { key: '贡献人', title: '贡献人', dataIndex: '贡献人', width: 100 },
    { key: '核心', title: '核心', width: 60, render: (_: unknown, r: LeaderboardEntry) => r.byLevel['核心'] ?? 0 },
    { key: '关键', title: '关键', width: 60, render: (_: unknown, r: LeaderboardEntry) => r.byLevel['关键'] ?? 0 },
    { key: '普通', title: '普通', width: 60, render: (_: unknown, r: LeaderboardEntry) => r.byLevel['普通'] ?? 0 },
    { key: '总数', title: '总数', dataIndex: '贡献数', width: 60 },
    { key: '加权分', title: '加权分', dataIndex: 'score', width: 80, sorter: (a: LeaderboardEntry, b: LeaderboardEntry) => a.score - b.score },
  ];

  const { columns: flexCols, FlexWrapper } = useFlexTable('honor', columns);
  const tableComponents = useMemo(() => ({ header: { cell: FlexHeaderCell } }), []);

  return (
    <FlexWrapper>
      <Table rowKey="贡献人" dataSource={entries} columns={flexCols} components={tableComponents}
        pagination={{ pageSize: PAGE_SIZE, showTotal: t => `共 ${t} 条` }} size="small"
        onRow={(r) => ({ onClick: () => navigate(`/honor/${encodeURIComponent(r.贡献人)}`), style: { cursor: 'pointer' } })}
      />
    </FlexWrapper>
  );
}

function asArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean);
  if (value == null || value === '') return [];
  return [String(value)];
}

function TeamCard({ node, selected, onSelect }: { node: GraphNode; selected: boolean; onSelect: (n: GraphNode) => void }) {
  const p = node.properties;
  const level = String(p['贡献等级'] ?? '');
  const members = asArray(p['组员']);
  return (
    <Card size="small" hoverable onClick={() => onSelect(node)}
      style={selected ? { borderColor: '#1677ff', boxShadow: '0 0 0 2px rgba(22,119,255,0.2)' } : undefined}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Text strong ellipsis style={{ flex: 1 }}>{String(p['团队名称'] ?? '未命名团队')}</Text>
        {level && <StatusTag status={level} type="contribution" />}
      </div>
      <div><Text type="secondary">类型：{String(p['贡献类型'] ?? '-')}</Text></div>
      <div><Text type="secondary">组长：{String(p['组长'] ?? '-')}</Text></div>
      <div><Text type="secondary">组员 × {members.length}</Text></div>
      <div><Text type="secondary">关联攻关单：{String(p['关联攻关单'] ?? '-')}</Text></div>
    </Card>
  );
}

function TeamDetail({ node }: { node: GraphNode }) {
  const p = node.properties;
  const level = String(p['贡献等级'] ?? '');
  const members = asArray(p['组员']);
  return (
    <Descriptions column={1} size="small" bordered>
      <Descriptions.Item label="团队名称">{String(p['团队名称'] ?? '-')}</Descriptions.Item>
      <Descriptions.Item label="等级">{level ? <StatusTag status={level} type="contribution" /> : '-'}</Descriptions.Item>
      <Descriptions.Item label="类型">{String(p['贡献类型'] ?? '-')}</Descriptions.Item>
      <Descriptions.Item label="周期">{String(p['周期'] ?? '-')}</Descriptions.Item>
      <Descriptions.Item label="组长">{String(p['组长'] ?? '-')}</Descriptions.Item>
      <Descriptions.Item label="组员">
        {members.length > 0 ? members.map((m) => <Tag key={m}>{m}</Tag>) : '-'}
      </Descriptions.Item>
      <Descriptions.Item label="关联攻关单">{String(p['关联攻关单'] ?? '-')}</Descriptions.Item>
      <Descriptions.Item label="记录时间">{node.createdAt ? dayjs(node.createdAt).format(DATE_FORMAT_FULL) : '-'}</Descriptions.Item>
      <Descriptions.Item label="描述">{String(p['描述'] ?? '-')}</Descriptions.Item>
    </Descriptions>
  );
}
