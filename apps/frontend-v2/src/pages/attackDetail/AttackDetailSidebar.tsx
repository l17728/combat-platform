import { Card, Space, Tag, Button, List, Avatar, Typography } from "antd";
import { CloseOutlined, HistoryOutlined, UserOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { nodeLabel } from "../../utils/nodeLabel.js";
import dayjs from "dayjs";
import type { HelperRecommendation } from "@combat/shared";
import type { CategorizedAudit } from "../../utils/auditFilter.js";

const { Text } = Typography;

export interface AttackDetailSidebarProps {
  ticketId: string;
  visibleCards: string[];
  helpers: HelperRecommendation[];
  keyAudits: CategorizedAudit[];
  isAdmin: boolean;
  isLeader: boolean;
  onHide: (key: string) => void;
}

export default function AttackDetailSidebar({
  ticketId,
  visibleCards,
  helpers,
  keyAudits,
  isAdmin,
  isLeader,
  onHide,
}: AttackDetailSidebarProps) {
  const navigate = useNavigate();
  if (visibleCards.length === 0) return null;

  return (
    <>
      {visibleCards.includes("helpers") && helpers.length > 0 && (
        <Card
          title="找帮手推荐"
          size="small"
          style={{ marginBottom: 16 }}
          extra={
            <Space size={4}>
              <Tag>{helpers.length}人</Tag>
              <Button type="text" size="small" icon={<CloseOutlined />} onClick={() => onHide("helpers")} />
            </Space>
          }
        >
          <List
            size="small"
            dataSource={helpers}
            renderItem={(h, i) => (
              <List.Item style={{ padding: "6px 0" }}>
                <Space>
                  <Tag color={i === 0 ? "gold" : i === 1 ? "#c0c0c0" : i === 2 ? "#cd7f32" : "default"}>#{i + 1}</Tag>
                  <Avatar size="small" icon={<UserOutlined />} />
                  <Text strong>{(h.person.properties["姓名"] as string) ?? nodeLabel(h.person)}</Text>
                  <Text type="secondary">{h.score}分</Text>
                </Space>
              </List.Item>
            )}
          />
        </Card>
      )}
      {visibleCards.includes("audit") && isLeader && (
        <Card
          title="合规追溯"
          size="small"
          style={{ marginBottom: 16 }}
          extra={
            <Space size={4}>
              <HistoryOutlined />
              <Button type="text" size="small" icon={<CloseOutlined />} onClick={() => onHide("audit")} />
            </Space>
          }
        >
          {isAdmin && keyAudits.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                最近关键事件
              </Text>
              <List
                size="small"
                dataSource={keyAudits.slice(0, 3)}
                renderItem={(c) => (
                  <List.Item style={{ padding: "4px 0" }}>
                    <Space size={6}>
                      <Tag color={c.color} style={{ margin: 0 }}>
                        {c.kind}
                      </Tag>
                      <Text style={{ fontSize: 12 }}>{c.summary}</Text>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {dayjs(c.entry.performedAt).format("MM/DD HH:mm")}
                      </Text>
                    </Space>
                  </List.Item>
                )}
              />
            </div>
          )}
          <Button
            type="link"
            icon={<HistoryOutlined />}
            onClick={() => navigate(`/audit?entityId=${ticketId}`)}
            style={{ paddingLeft: 0 }}
          >
            查看完整历史 →
          </Button>
        </Card>
      )}
    </>
  );
}
