import { useEffect, useMemo, useState } from "react";
import {
  Row,
  Col,
  Card,
  Statistic,
  Typography,
  List,
  Tag,
  Skeleton,
  Empty,
  Tooltip,
  theme,
  Tabs,
  Drawer,
  Button,
  Space,
  Checkbox,
} from "antd";
import {
  ThunderboltOutlined,
  CheckCircleOutlined,
  FileTextOutlined,
  ClockCircleOutlined,
  DashboardOutlined,
  NotificationOutlined,
  UserOutlined,
  SettingOutlined,
  UpOutlined,
  DownOutlined,
  StarFilled,
  WarningOutlined,
  BookOutlined,
} from "@ant-design/icons";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { STATUS_COLOR, STATUS_BAR_COLOR } from "../constants.js";
import StatusTag from "../components/StatusTag.js";
import type { DashboardSummary, GraphNode } from "@combat/shared";
import HelpButton from "../components/HelpButton.js";
import HELP from "../help-content.js";
import InfoSquare from "./InfoSquare.js";
import WikiPanel from "../components/WikiPanel.js";
import { useAuth } from "../hooks/useAuth.js";
import { useDashboardConfig } from "../hooks/useDashboardConfig.js";
import ProductTour from "../components/ProductTour.js";
import dashboardTourSteps from "../tours/dashboardTour.js";
import adminTourSteps from "../tours/adminTour.js";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import "dayjs/locale/zh-cn";

dayjs.extend(relativeTime);
dayjs.locale("zh-cn");

const { Title } = Typography;

// 状态=处理中/进行中 + 创建超过 N 天 即视为有 SLA 风险(可后续接 SLA 配置;此处先取 3 天)
const SLA_DAYS = 3;
const ACTIVE_STATUSES = new Set(["处理中", "进行中", "待响应"]);
const favKey = (username?: string) => `combat-attack-favorites:${username || "guest"}`;

function DashboardContent() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [ticketNodes, setTicketNodes] = useState<GraphNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const { user, isAdmin } = useAuth();
  const { cards, toggleVisible, moveUp, moveDown, resetToDefault, isVisible, visibleOrder } = useDashboardConfig();

  useEffect(() => {
    Promise.all([api.getDashboard(), api.listNodes("attackTicket").catch(() => [] as GraphNode[])])
      .then(([summary, list]) => {
        setData(summary);
        setTicketNodes(list as GraphNode[]);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // "我的关注":从 localStorage 取本人 favorites,过滤出仍存在的 ticket
  const favorites = useMemo<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(favKey(user?.username)) || "[]"));
    } catch {
      return new Set();
    }
  }, [user?.username]);

  const me = (user?.displayName || user?.username || "").trim();

  const myTickets = useMemo(() => {
    if (!me) return [];
    return ticketNodes
      .filter((t) => {
        const handler = String(t.properties["当前处理人"] ?? "").trim();
        const status = String(t.properties["状态"] ?? "");
        return handler === me && ACTIVE_STATUSES.has(status);
      })
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 5);
  }, [ticketNodes, me]);

  const favoriteTickets = useMemo(() => {
    if (favorites.size === 0) return [];
    return ticketNodes
      .filter((t) => favorites.has(t.id))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 5);
  }, [ticketNodes, favorites]);

  const slaRiskTickets = useMemo(() => {
    const now = Date.now();
    return ticketNodes
      .filter((t) => {
        const status = String(t.properties["状态"] ?? "");
        if (!ACTIVE_STATUSES.has(status)) return false;
        const created = new Date(t.createdAt).getTime();
        return now - created > SLA_DAYS * 24 * 3600 * 1000;
      })
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .slice(0, 5);
  }, [ticketNodes]);

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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          作战态势
        </Title>
        <Tooltip title="看板设置">
          <Button icon={<SettingOutlined />} onClick={() => setConfigOpen(true)} />
        </Tooltip>
      </div>
      {isVisible("stats") && (
        <Row gutter={[16, 16]}>
          <Col xs={12} sm={12} md={6}>
            <Card hoverable onClick={() => navigate("/attack")} style={{ cursor: "pointer" }}>
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
                valueStyle={{ color: "#389e0d" }}
              />
            </Card>
          </Col>
          <Col xs={12} sm={12} md={6}>
            <Card>
              <Statistic title="总攻关单" value={tickets.total} prefix={<FileTextOutlined />} />
            </Card>
          </Col>
          <Col xs={12} sm={12} md={6}>
            <Card>
              <Statistic
                title="今日进展"
                value={today.progressEntries}
                prefix={<ClockCircleOutlined />}
                valueStyle={{ color: "#d48806" }}
              />
            </Card>
          </Col>
        </Row>
      )}

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        {isVisible("myTasks") && (
          <Col xs={24} md={8}>
            <Card
              size="small"
              title={
                <span>
                  <UserOutlined style={{ color: token.colorPrimary }} /> 分配给我
                </span>
              }
              extra={
                <a
                  onClick={() =>
                    navigate(`/attack?field=${encodeURIComponent("当前处理人")}&val=${encodeURIComponent(me)}`)
                  }
                >
                  查看全部
                </a>
              }
              data-tour="my-tasks"
            >
              {myTickets.length === 0 ? (
                <Empty
                  description={me ? "当前无分配给你的进行中攻关" : "未登录"}
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              ) : (
                <List
                  size="small"
                  dataSource={myTickets}
                  renderItem={(t) => (
                    <List.Item
                      style={{ cursor: "pointer", padding: "6px 0" }}
                      onClick={() => navigate(`/attack/${t.id}`)}
                    >
                      <div
                        style={{
                          width: "100%",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                          {String(t.properties["标题"] ?? t.id.slice(0, 8))}
                        </span>
                        <StatusTag status={String(t.properties["状态"] ?? "-")} />
                      </div>
                    </List.Item>
                  )}
                />
              )}
            </Card>
          </Col>
        )}
        {isVisible("favorites") && (
          <Col xs={24} md={8}>
            <Card
              size="small"
              title={
                <span>
                  <StarFilled style={{ color: "#fadb14" }} /> 我的关注
                </span>
              }
              extra={<a onClick={() => navigate("/attack?tab=favorites")}>查看全部</a>}
            >
              {favoriteTickets.length === 0 ? (
                <Empty description="尚无关注 ★ 攻关单" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                <List
                  size="small"
                  dataSource={favoriteTickets}
                  renderItem={(t) => (
                    <List.Item
                      style={{ cursor: "pointer", padding: "6px 0" }}
                      onClick={() => navigate(`/attack/${t.id}`)}
                    >
                      <div
                        style={{
                          width: "100%",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                          {String(t.properties["标题"] ?? t.id.slice(0, 8))}
                        </span>
                        <StatusTag status={String(t.properties["状态"] ?? "-")} />
                      </div>
                    </List.Item>
                  )}
                />
              )}
            </Card>
          </Col>
        )}
        {isVisible("slaRisk") && (
          <Col xs={24} md={8}>
            <Card
              size="small"
              title={
                <span>
                  <WarningOutlined style={{ color: "#fa541c" }} /> SLA 风险
                </span>
              }
              extra={
                <Tooltip title={`进行中且创建超过 ${SLA_DAYS} 天`}>
                  <a>规则</a>
                </Tooltip>
              }
            >
              {slaRiskTickets.length === 0 ? (
                <Empty description="无超期攻关 ✓" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                <List
                  size="small"
                  dataSource={slaRiskTickets}
                  renderItem={(t) => {
                    const ageDays = Math.floor((Date.now() - new Date(t.createdAt).getTime()) / (24 * 3600 * 1000));
                    return (
                      <List.Item
                        style={{ cursor: "pointer", padding: "6px 0" }}
                        onClick={() => navigate(`/attack/${t.id}`)}
                      >
                        <div
                          style={{
                            width: "100%",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                            {String(t.properties["标题"] ?? t.id.slice(0, 8))}
                          </span>
                          <Tag color="orange">超 {ageDays} 天</Tag>
                        </div>
                      </List.Item>
                    );
                  }}
                />
              )}
            </Card>
          </Col>
        )}
      </Row>

      {isVisible("recent") && (
        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col xs={24} lg={14}>
            <Card title="最近活跃攻关" extra={<a onClick={() => navigate("/attack")}>查看全部</a>}>
              {recent.length === 0 ? (
                <Empty description="暂无攻关记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                <List
                  dataSource={recent.slice(0, 10)}
                  renderItem={(item) => (
                    <List.Item
                      style={{ cursor: "pointer", padding: "8px 0" }}
                      onClick={() => navigate(`/attack/${item.ticketId}`)}
                    >
                      <List.Item.Meta
                        title={
                          <span>
                            {item.标题 || item.ticketId.slice(0, 8)}
                            <StatusTag status={item.状态 || "-"} />
                          </span>
                        }
                        description={
                          <Tooltip title={dayjs(item.lastChangedAt).format("YYYY-MM-DD HH:mm")}>
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

          {isVisible("statusBar") && (
            <Col xs={24} lg={10}>
              <Card title="状态分布">
                {Object.keys(tickets.byStatus).length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {Object.entries(tickets.byStatus).map(([status, count]) => {
                      const maxCount = Math.max(...Object.values(tickets.byStatus));
                      return (
                        <div key={status} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <Tag
                            color={STATUS_COLOR[status] ?? "default"}
                            style={{ width: 80, textAlign: "center", flexShrink: 0 }}
                          >
                            {status}
                          </Tag>
                          <div
                            style={{
                              flex: 1,
                              height: 20,
                              background: token.colorBgLayout,
                              borderRadius: 4,
                              overflow: "hidden",
                            }}
                          >
                            <div
                              style={{
                                height: "100%",
                                width: `${maxCount > 0 ? (count / maxCount) * 100 : 0}%`,
                                background: STATUS_BAR_COLOR[status] ?? token.colorTextDisabled,
                                borderRadius: 4,
                                transition: "width 0.3s",
                              }}
                            />
                          </div>
                          <span style={{ width: 30, textAlign: "right", flexShrink: 0 }}>{count}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <Empty description="暂无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                )}
              </Card>
            </Col>
          )}
        </Row>
      )}
      <Drawer
        title="看板设置"
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        width={360}
        maskClosable
        footer={<Button onClick={resetToDefault}>恢复默认</Button>}
      >
        {cards.map((card, idx) => (
          <div
            key={card.id}
            style={{
              display: "flex",
              alignItems: "center",
              padding: "8px 0",
              borderBottom: `1px solid ${token.colorBorderSecondary}`,
            }}
          >
            <Checkbox checked={card.visible} onChange={() => toggleVisible(card.id)} />
            <span style={{ flex: 1, marginLeft: 8 }}>{card.label}</span>
            <Space size={4}>
              <Button size="small" icon={<UpOutlined />} disabled={idx === 0} onClick={() => moveUp(card.id)} />
              <Button
                size="small"
                icon={<DownOutlined />}
                disabled={idx === cards.length - 1}
                onClick={() => moveDown(card.id)}
              />
            </Space>
          </div>
        ))}
      </Drawer>
      <ProductTour tourId="dashboard" steps={dashboardTourSteps} />
      {isAdmin && <ProductTour tourId="admin" steps={adminTourSteps} />}
    </div>
  );
}

export default function Dashboard() {
  const [searchParams] = useSearchParams();
  const [activeKey, setActiveKey] = useState(searchParams.get("tab") === "square" ? "square" : "dashboard");

  return (
    <div>
      <div style={{ position: "relative", marginBottom: 0 }}>
        {activeKey === "dashboard" && (
          <div style={{ position: "absolute", top: 8, right: 0, zIndex: 1 }}>
            <HelpButton title={HELP.dashboard.title} content={HELP.dashboard.content} />
          </div>
        )}
        <Tabs
          activeKey={activeKey}
          onChange={setActiveKey}
          size="large"
          style={{ width: "100%" }}
          items={[
            {
              key: "dashboard",
              label: (
                <span>
                  <DashboardOutlined /> 作战态势
                </span>
              ),
              children: <DashboardContent />,
            },
            {
              key: "square",
              label: (
                <span>
                  <NotificationOutlined /> 信息广场
                </span>
              ),
              children: <InfoSquare />,
            },
            {
              key: "wiki",
              label: (
                <span>
                  <BookOutlined /> 知识库
                </span>
              ),
              children: <WikiPanel scope="global" />,
            },
          ]}
        />
      </div>
    </div>
  );
}
