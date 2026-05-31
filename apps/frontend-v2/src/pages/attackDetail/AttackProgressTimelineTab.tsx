import { Button, Space, Typography, Empty, Timeline, Tag } from "antd";
import { PlusOutlined, HistoryOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import StatusTag from "../../components/StatusTag.js";
import { STATUS_COLOR } from "../../constants.js";
import { filterKeyAudits } from "../../utils/auditFilter.js";
import dayjs from "dayjs";
import type { AuditLogEntry, ProgressLog } from "@combat/shared";

const { Text, Paragraph } = Typography;

export interface AttackProgressTimelineTabProps {
  ticketId: string;
  progress: ProgressLog[];
  auditLogs: AuditLogEntry[];
  isLeader: boolean;
  onOpenAddProgress: () => void;
}

export default function AttackProgressTimelineTab({
  ticketId,
  progress,
  auditLogs,
  isLeader,
  onOpenAddProgress,
}: AttackProgressTimelineTabProps) {
  const navigate = useNavigate();
  const keyAudits = filterKeyAudits(auditLogs);
  type TLEntry = { ts: string; color: string; node: React.ReactNode };
  const progressTL: TLEntry[] = progress.map((p) => ({
    ts: p.updatedAt,
    color: STATUS_COLOR[p.statusSnapshot] ?? "gray",
    node: (
      <div>
        <div>
          <Text strong>{dayjs(p.updatedAt).format("MM/DD HH:mm")}</Text> <StatusTag status={p.statusSnapshot} />
        </div>
        <Paragraph style={{ margin: "4px 0 0" }}>{p.content}</Paragraph>
      </div>
    ),
  }));
  const auditTL: TLEntry[] = keyAudits.map((c, i) => ({
    ts: c.entry.performedAt,
    color: c.color,
    node: (
      <div key={`a-${i}`}>
        <div>
          <Text strong>{dayjs(c.entry.performedAt).format("MM/DD HH:mm")}</Text>
          <Tag color={c.color} style={{ marginLeft: 6 }}>
            {c.kind}
          </Tag>
          {c.entry.performedBy && (
            <Text type="secondary" style={{ marginLeft: 4 }}>
              · {c.entry.performedBy}
            </Text>
          )}
        </div>
        <Paragraph style={{ margin: "4px 0 0" }}>{c.summary}</Paragraph>
      </div>
    ),
  }));
  const timelineItems = [...progressTL, ...auditTL]
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
    .map((e, idx) => ({ color: e.color, children: <div key={idx}>{e.node}</div> }));

  return (
    <div style={{ padding: "16px 0" }}>
      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={onOpenAddProgress}>
          追加进展
        </Button>
        {isLeader && (
          <Button icon={<HistoryOutlined />} onClick={() => navigate(`/audit?entityId=${ticketId}`)}>
            查看完整历史
          </Button>
        )}
      </Space>
      {timelineItems.length === 0 ? (
        <Empty description="暂无进展记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <Timeline items={timelineItems} />
      )}
    </div>
  );
}
