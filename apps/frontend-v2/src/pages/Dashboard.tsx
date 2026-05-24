import { useEffect, useState } from 'react';
import { Row, Col, Card, Statistic, Typography, List, Tag, Skeleton, Empty } from 'antd';
import {
  ThunderboltOutlined,
  CheckCircleOutlined,
  FileTextOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { STATUS_COLOR } from '../constants.js';
import type { DashboardSummary } from '@combat/shared';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const { Title } = Typography;

export default function Dashboard() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    api
      .getDashboard()
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Skeleton active paragraph={{ rows: 8 }} />;

  const tickets = data?.tickets ?? { total: 0, byStatus: {}, open: 0, resolved: 0 };
  const today = data?.today ?? { progressEntries: 0, ticketsTouched: 0 };
  const recent = data?.recentActivity ?? [];

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>
        作战态势
      </Title>

      <Row gutter={[16, 16]}>
        <Col span={6}>
          <Card>
            <Statistic
              title="进行中"
              value={tickets.open}
              prefix={<ThunderboltOutlined />}
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="已闭环"
              value={tickets.resolved}
              prefix={<CheckCircleOutlined />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="总攻关单"
              value={tickets.total}
              prefix={<FileTextOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="今日进展"
              value={today.progressEntries}
              prefix={<ClockCircleOutlined />}
              valueStyle={{ color: '#faad14' }}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col span={14}>
          <Card title="最近活跃攻关" extra={<a onClick={() => navigate('/attack')}>查看全部</a>}>
            {recent.length === 0 ? (
              <Empty description="暂无攻关记录" />
            ) : (
              <List
                dataSource={recent.slice(0, 10)}
                renderItem={(item) => (
                  <List.Item
                    style={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/attack/${item.ticketId}`)}
                  >
                    <List.Item.Meta
                      title={
                        <span>
                          {item.标题 || item.ticketId.slice(0, 8)}
                          <Tag
                            color={STATUS_COLOR[item.状态] ?? 'default'}
                            style={{ marginLeft: 8 }}
                          >
                            {item.状态 || '-'}
                          </Tag>
                        </span>
                      }
                      description={dayjs(item.lastChangedAt).fromNow()}
                    />
                  </List.Item>
                )}
              />
            )}
          </Card>
        </Col>

        <Col span={10}>
          <Card title="状态分布">
            {Object.keys(tickets.byStatus).length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {Object.entries(tickets.byStatus).map(([status, count]) => {
                  const maxCount = Math.max(...Object.values(tickets.byStatus));
                  return (
                    <div key={status} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Tag
                        color={STATUS_COLOR[status] ?? 'default'}
                        style={{ width: 80, textAlign: 'center' }}
                      >
                        {status}
                      </Tag>
                      <div
                        style={{
                          flex: 1,
                          height: 20,
                          background: '#f0f0f0',
                          borderRadius: 4,
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            height: '100%',
                            width: `${maxCount > 0 ? (count / maxCount) * 100 : 0}%`,
                            background:
                              STATUS_COLOR[status] === 'gold'
                                ? '#faad14'
                                : STATUS_COLOR[status] === 'blue'
                                  ? '#1890ff'
                                  : STATUS_COLOR[status] === 'cyan'
                                    ? '#13c2c2'
                                    : STATUS_COLOR[status] === 'green'
                                      ? '#52c41a'
                                      : '#d9d9d9',
                            borderRadius: 4,
                            transition: 'width 0.3s',
                          }}
                        />
                      </div>
                      <span style={{ width: 30, textAlign: 'right' }}>{count}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <Empty description="暂无数据" />
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
