import { useEffect, useState } from 'react';
import { Typography, Card, List, Tag, Skeleton, Empty, Select, Table, Space, Tabs, Button } from 'antd';
import { TrophyOutlined, ExportOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { CONTRIBUTION_COLOR, PAGE_SIZE } from '../constants.js';
import type { LeaderboardEntry } from '@combat/shared';
import type { TeamLeaderboardEntry } from '../api.js';
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
  const [teamEntries, setTeamEntries] = useState<TeamLeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<string | undefined>();
  const [tab, setTab] = useState('personal');
  const navigate = useNavigate();

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.getLeaderboard(period),
      api.getTeamLeaderboard(period),
    ]).then(([personal, team]) => {
      setEntries(personal);
      setTeamEntries(team);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [period]);

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
        <Title level={4} style={{ margin: 0 }}>
          <TrophyOutlined style={{ color: '#faad14', marginRight: 8 }} />
          荣誉殿堂
        </Title>
        <Space>
          <Select placeholder="选择周期" allowClear style={{ width: 140 }} value={period} onChange={setPeriod}
            options={quarters.map((p) => ({ value: p, label: p }))} />
          <Button icon={<ExportOutlined />} onClick={handleExport}>导出数据</Button>
        </Space>
      </div>

      {loading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : entries.length === 0 ? (
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
                  <Table rowKey="贡献人" dataSource={entries} pagination={{ pageSize: PAGE_SIZE, showTotal: t => `共 ${t} 条` }} size="small"
                    onRow={(r) => ({ onClick: () => navigate(`/honor/${encodeURIComponent(r.贡献人)}`), style: { cursor: 'pointer' } })}
                    columns={[
                      { title: '名次', width: 60, render: (_: unknown, __: unknown, i: number) => <RankTag rank={i} /> },
                      { title: '贡献人', dataIndex: '贡献人', width: 100 },
                      { title: '核心', width: 60, render: (_: unknown, r: LeaderboardEntry) => r.byLevel['核心'] ?? 0 },
                      { title: '关键', width: 60, render: (_: unknown, r: LeaderboardEntry) => r.byLevel['关键'] ?? 0 },
                      { title: '普通', width: 60, render: (_: unknown, r: LeaderboardEntry) => r.byLevel['普通'] ?? 0 },
                      { title: '总数', dataIndex: '贡献数', width: 60 },
                      { title: '加权分', dataIndex: 'score', width: 80, sorter: (a: LeaderboardEntry, b: LeaderboardEntry) => a.score - b.score },
                    ]}
                  />
                </Card>
              </>
            ),
          },
          {
            key: 'team',
            label: '团队排行',
            children: teamEntries.length === 0 ? <Empty description="暂无团队数据" /> : (
              <Card>
                <Table rowKey="team" dataSource={teamEntries} pagination={false} size="small"
                  columns={[
                    { title: '名次', width: 60, render: (_: unknown, __: unknown, i: number) => <RankTag rank={i} /> },
                    { title: '团队', dataIndex: 'team', width: 120 },
                    { title: '贡献数', dataIndex: '贡献数', width: 80 },
                    { title: '加权分', dataIndex: 'score', width: 100, sorter: (a: TeamLeaderboardEntry, b: TeamLeaderboardEntry) => a.score - b.score },
                  ]}
                />
              </Card>
            ),
          },
        ]} />
      )}
    </div>
  );
}
