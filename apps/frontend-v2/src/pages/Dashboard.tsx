import { useEffect, useState } from 'react';
import { Row, Col, Card, Statistic, Typography, List, Tag, Skeleton, Empty, Tooltip, theme, Tabs } from 'antd';
import {
  ThunderboltOutlined,
  CheckCircleOutlined,
  FileTextOutlined,
  ClockCircleOutlined,
  DashboardOutlined,
  NotificationOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { STATUS_COLOR, STATUS_BAR_COLOR } from '../constants.js';
import StatusTag from '../components/StatusTag.js';
import type { DashboardSummary } from '@combat/shared';
import HelpButton from '../components/HelpButton.js';
import HELP from '../help-content.js';
import InfoSquare from './InfoSquare.js';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const { Title } = Typography;

function DashboardContent() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { token } = theme.useToken();

  useEffect(() => {
    api
      .getDashboard()
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Skeleton active paragraph={{ rows: 8 }} />;

  if (error) {
    return (
      <div>
        <Title level={4}>作战态势</Title>
        <Empty description={`加载失败：${error}`}>
          <button onClick={() => window.location.reload()}>重新加载</button>
        </Empty>
      </div>
    );
  }

  const tickets = data?.tickets ?? { total: 0, byStatus: {}, open: 0, resolved: 0 };
  const today = data?.today ?? { progressEntries: 0, ticketsTouched: 0 };
  const recent = data?.recentActivity ?? [];

  return (
    <div>
      <Row gutter={[16, 16]}>
        <Col xs={12} sm={12} md={6}>
          <Card hoverable onClick={() => navigate('/attack')} style={{ cursor: 'pointer' }}>
            <Statistic
              title="进行中"
              value={tickets.open}
              prefix={<ThunderboltOutlined />}
              valueStyle={{ color: token.colorPrimary }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={12} md={6}>
          <Card>
            <Statistic
              title="已闭环"
              value={tickets.resolved}
              prefix={<CheckCircleOutlined />}
              valueStyle={{ color: '#389e0d' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={12} md={6}>
          <Card>
            <Statistic
              title="总攻关单"
              value={tickets.total}
              prefix={<FileTextOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={12} md={6}>
          <Card>
            <Statistic
              title="今日进展"
              value={today.progressEntries}
              prefix={<ClockCircleOutlined />}
              valueStyle={{ color: '#d48806' }}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={14}>
          <Card title="最近活跃攻关" extra={<a onClick={() => navigate('/attack')}>查看全部</a>}>
            {recent.length === 0 ? (
              <Empty description="暂无攻关记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <List
                dataSource={recent.slice(0, 10)}
                renderItem={(item) => (
                  <List.Item
                    style={{ cursor: 'pointer', padding: '8px 0' }}
                    onClick={() => navigate(`/attack/${item.ticketId}`)}
                  >
                    <List.Item.Meta
                      title={
                        <span>
                          {item.标题 || item.ticketId.slice(0, 8)}
                          <StatusTag status={item.状态 || '-'} />
                        </span>
                      }
                      description={
                        <Tooltip title={dayjs(item.lastChangedAt).format('YYYY-MM-DD HH:mm')}>
                          <span>{dayjs(item.lastChangedAt).fromNow()}</span>
                        </Tooltip>
                      }
                    />
                  </List.Item>
                )}
              />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Card title="状态分布">
            {Object.keys(tickets.byStatus).length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {Object.entries(tickets.byStatus).map(([status, count]) => {
                  const maxCount = Math.max(...Object.values(tickets.byStatus));
                  return (
                    <div key={status} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Tag
                        color={STATUS_COLOR[status] ?? 'default'}
                        style={{ width: 80, textAlign: 'center', flexShrink: 0 }}
                      >
                        {status}
                      </Tag>
                      <div
                        style={{
                          flex: 1,
                          height: 20,
                          background: token.colorBgLayout,
                          borderRadius: 4,
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            height: '100%',
                            width: `${maxCount > 0 ? (count / maxCount) * 100 : 0}%`,
                            background: STATUS_BAR_COLOR[status] ?? token.colorTextDisabled,
                            borderRadius: 4,
                            transition: 'width 0.3s',
                          }}
                        />
                      </div>
                      <span style={{ width: 30, textAlign: 'right', flexShrink: 0 }}>{count}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <Empty description="暂无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}

export default function Dashboard() {
  const [activeKey, setActiveKey] = useState('dashboard');

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 0 }}>
        <Tabs
          activeKey={activeKey}
          onChange={setActiveKey}
          size="large"
          items={[
            {
              key: 'dashboard',
              label: <span><DashboardOutlined /> 作战态势</span>,
              children: <DashboardContent />,
            },
            {
              key: 'square',
              label: <span><NotificationOutlined /> 信息广场</span>,
              children: <InfoSquare />,
            },
          ]}
        />
        {activeKey === 'dashboard' && (
          <HelpButton title={HELP.dashboard.title} content={HELP.dashboard.content} />
        )}
      </div>
    </div>
  );
}
