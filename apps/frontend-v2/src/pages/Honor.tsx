import { useEffect, useState } from 'react';
import { Typography, Card, List, Tag, Skeleton, Empty, Select, Table, Space } from 'antd';
import { TrophyOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { CONTRIBUTION_COLOR } from '../constants.js';
import type { LeaderboardEntry } from '@combat/shared';

const { Title, Text } = Typography;

export default function Honor() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<string | undefined>();
  const navigate = useNavigate();

  useEffect(() => {
    setLoading(true);
    api
      .getLeaderboard(period)
      .then(setEntries)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [period]);

  const medals = ['🥇', '🥈', '🥉'];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          <TrophyOutlined style={{ color: '#faad14', marginRight: 8 }} />
          荣誉殿堂
        </Title>
        <Select
          placeholder="选择周期"
          allowClear
          style={{ width: 140 }}
          value={period}
          onChange={setPeriod}
          options={['2026-Q2', '2026-Q1'].map((p) => ({ value: p, label: p }))}
        />
      </div>

      {loading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : entries.length === 0 ? (
        <Empty description="暂无贡献数据" />
      ) : (
        <>
          <Card style={{ marginBottom: 16 }}>
            <List
              dataSource={entries.slice(0, 10)}
              renderItem={(entry, i) => (
                <List.Item
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/honor/${encodeURIComponent(entry.贡献人)}`)}
                >
                  <List.Item.Meta
                    avatar={
                      <span style={{ fontSize: 24, width: 40, textAlign: 'center' }}>
                        {medals[i] || `${i + 1}`}
                      </span>
                    }
                    title={
                      <span>
                        {entry.贡献人}
                        <Text type="secondary" style={{ marginLeft: 12 }}>
                          加权 {entry.score}
                        </Text>
                      </span>
                    }
                    description={
                      <Space>
                        {Object.entries(entry.byLevel).map(([level, count]) => (
                          <Tag key={level} color={CONTRIBUTION_COLOR[level] ?? 'default'}>
                            {level} × {count}
                          </Tag>
                        ))}
                      </Space>
                    }
                  />
                </List.Item>
              )}
            />
          </Card>

          <Card title="详细排行">
            <Table
              rowKey="贡献人"
              dataSource={entries}
              pagination={false}
              size="small"
              onRow={(r) => ({
                onClick: () => navigate(`/honor/${encodeURIComponent(r.贡献人)}`),
                style: { cursor: 'pointer' },
              })}
              columns={[
                { title: '名次', width: 60, render: (_: unknown, __: unknown, i: number) => medals[i] || i + 1 },
                { title: '贡献人', dataIndex: '贡献人', width: 100 },
                {
                  title: '核心',
                  width: 60,
                  render: (_: unknown, r: LeaderboardEntry) => r.byLevel['核心'] ?? 0,
                },
                {
                  title: '关键',
                  width: 60,
                  render: (_: unknown, r: LeaderboardEntry) => r.byLevel['关键'] ?? 0,
                },
                {
                  title: '普通',
                  width: 60,
                  render: (_: unknown, r: LeaderboardEntry) => r.byLevel['普通'] ?? 0,
                },
                { title: '总数', dataIndex: '贡献数', width: 60 },
                { title: '加权分', dataIndex: 'score', width: 80 },
              ]}
            />
          </Card>
        </>
      )}
    </div>
  );
}
