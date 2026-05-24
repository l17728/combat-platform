import { useEffect, useState } from 'react';
import { Typography, Card, List, Tag, Skeleton, Empty, Button, Space, Tooltip, Descriptions, Statistic, Row, Col } from 'antd';
import { ArrowLeftOutlined, TrophyOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { CONTRIBUTION_COLOR } from '../constants.js';
import StatusTag from '../components/StatusTag.js';
import type { PersonHonor } from '@combat/shared';

const { Title, Text, Paragraph } = Typography;

export default function PersonHonor() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<PersonHonor | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!name) return;
    setLoading(true);
    api
      .getPersonHonor(decodeURIComponent(name))
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [name]);

  if (loading) return <Skeleton active paragraph={{ rows: 6 }} />;
  if (!data) return <Empty description="未找到该人员荣誉信息" />;

  const byLevel: Record<string, number> = {};
  data.contributions.forEach((c) => {
    const level = (c.contribution.properties['贡献等级'] as string) ?? '普通';
    byLevel[level] = (byLevel[level] ?? 0) + 1;
  });

  const totalScore = data.contributions.reduce((sum, c) => {
    const level = (c.contribution.properties['贡献等级'] as string) ?? '普通';
    const weights: Record<string, number> = { '核心': 3, '关键': 2, '普通': 1 };
    return sum + (weights[level] ?? 1);
  }, 0);

  return (
    <div>
      <Button type="link" icon={<ArrowLeftOutlined />} onClick={() => navigate('/honor')} style={{ paddingLeft: 0, marginBottom: 16 }}>
        返回荣誉殿堂
      </Button>

      <Card style={{ marginBottom: 16 }}>
        <Row gutter={24} align="middle">
          <Col>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#fff7e6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <TrophyOutlined style={{ fontSize: 24, color: '#faad14' }} />
            </div>
          </Col>
          <Col flex={1}>
            <Title level={4} style={{ margin: 0 }}>{data.贡献人}</Title>
            <Space style={{ marginTop: 4 }}>
              {Object.entries(byLevel).map(([level, count]) => (
                <Tag key={level} color={CONTRIBUTION_COLOR[level] ?? 'default'}>
                  {level} × {count}
                </Tag>
              ))}
            </Space>
          </Col>
          <Col>
            <Row gutter={16}>
              <Col><Statistic title="贡献总数" value={data.contributions.length} /></Col>
              <Col><Statistic title="加权总分" value={totalScore} valueStyle={{ color: '#faad14' }} /></Col>
            </Row>
          </Col>
        </Row>
      </Card>

      <Card title="贡献列表">
        {data.contributions.length === 0 ? (
          <Empty description="暂无贡献记录" />
        ) : (
          <List
            dataSource={data.contributions}
            renderItem={(item) => {
              const p = item.contribution.properties;
              return (
                <List.Item>
                  <List.Item.Meta
                    title={
                      <Space>
                        <StatusTag status={(p['贡献等级'] as string) ?? '普通'} type="contribution" />
                        <Tag>{(p['贡献类型'] as string) ?? '-'}</Tag>
                        <Tooltip title={(p['描述'] as string) ?? '-'}>
                          <span>{(p['描述'] as string)?.slice(0, 80) ?? '-'}{(p['描述'] as string)?.length > 80 ? '...' : ''}</span>
                        </Tooltip>
                      </Space>
                    }
                    description={
                      <span>
                        周期: {(p['周期'] as string) ?? '-'}
                        {item.attackTicketId ? ` · 关联: ${item.attackTicketId.slice(0, 8)}` : null}
                        {p['记录时间'] ? ` · ${String(p['记录时间']).slice(0, 10)}` : null}
                      </span>
                    }
                  />
                </List.Item>
              );
            }}
          />
        )}
      </Card>
    </div>
  );
}
