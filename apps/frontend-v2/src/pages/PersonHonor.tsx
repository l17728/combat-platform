import { useEffect, useState } from 'react';
import { Typography, Card, List, Tag, Spin, Empty, Button, Space } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
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

  if (loading) return <Spin size="large" style={{ display: 'block', marginTop: 100 }} />;
  if (!data) return <Empty description="未找到该人员荣誉信息" />;

  const byLevel: Record<string, number> = {};
  data.contributions.forEach((c) => {
    const level = (c.contribution.properties['贡献等级'] as string) ?? '普通';
    byLevel[level] = (byLevel[level] ?? 0) + 1;
  });

  return (
    <div>
      <Button
        type="link"
        icon={<ArrowLeftOutlined />}
        onClick={() => navigate('/honor')}
        style={{ paddingLeft: 0, marginBottom: 16 }}
      >
        返回荣誉殿堂
      </Button>

      <Card style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          {data.贡献人}
        </Title>
        <Space style={{ marginTop: 8 }}>
          {Object.entries(byLevel).map(([level, count]) => (
            <Tag key={level} color={CONTRIBUTION_COLOR[level] ?? 'default'}>
              {level} × {count}
            </Tag>
          ))}
        </Space>
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
                      <span>
                        <StatusTag
                          status={(p['贡献等级'] as string) ?? '普通'}
                          type="contribution"
                        />
                        <Tag>{(p['贡献类型'] as string) ?? '-'}</Tag>
                        {(p['描述'] as string)?.slice(0, 60) ?? '-'}
                      </span>
                    }
                    description={
                      <span>
                        周期: {(p['周期'] as string) ?? '-'}
                        {item.attackTicketId && ` · 关联: ${item.attackTicketId.slice(0, 8)}`}
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
