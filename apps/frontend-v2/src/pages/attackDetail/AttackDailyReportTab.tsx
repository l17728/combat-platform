import { Button, Space, Table, Empty, Tag } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import type { DailyReportEntry } from "../../api.js";

export interface AttackDailyReportTabProps {
  dailyReports: DailyReportEntry[];
  drLoading: boolean;
  onOpenCreate: () => void;
  onOpenEdit: (entry: DailyReportEntry) => void;
  onOpenDetail: (entry: DailyReportEntry) => void;
  onPublish: (id: string) => Promise<void> | void;
  onDelete: (id: string) => Promise<void> | void;
}

export default function AttackDailyReportTab({
  dailyReports,
  drLoading,
  onOpenCreate,
  onOpenEdit,
  onOpenDetail,
  onPublish,
  onDelete,
}: AttackDailyReportTabProps) {
  const drColumns = [
    { title: "日报类型", dataIndex: "type", width: 100 },
    {
      title: "当前进展",
      dataIndex: "currentProgress",
      render: (v: string) => (v.length > 120 ? v.slice(0, 120) + "…" : v),
    },
    {
      title: "下一步计划",
      dataIndex: "nextSteps",
      render: (v: string) => (v ? (v.length > 80 ? v.slice(0, 80) + "…" : v) : "--"),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 80,
      render: (v: string) => <Tag color={v === "已发布" ? "green" : "default"}>{v}</Tag>,
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      width: 150,
      render: (v: string) => dayjs(v).format("MM/DD HH:mm"),
    },
    {
      title: "操作",
      width: 200,
      render: (_: unknown, r: DailyReportEntry) => (
        <Space size={4}>
          <Button size="small" type="link" onClick={() => onOpenDetail(r)}>
            详情
          </Button>
          <Button size="small" type="link" disabled={r.status === "已发布"} onClick={() => onOpenEdit(r)}>
            编辑
          </Button>
          <Button size="small" type="link" disabled={r.status === "已发布"} onClick={() => onPublish(r.id)}>
            发布
          </Button>
          <Button size="small" type="link" danger disabled={r.status === "已发布"} onClick={() => onDelete(r.id)}>
            删除
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: "16px 0" }}>
      <Button type="primary" icon={<PlusOutlined />} onClick={onOpenCreate} style={{ marginBottom: 16 }}>
        创建
      </Button>
      <Table
        size="small"
        loading={drLoading}
        dataSource={dailyReports}
        columns={drColumns}
        rowKey="id"
        pagination={{ pageSize: 10 }}
        locale={{
          emptyText: <Empty description="暂无日报条目" image={Empty.PRESENTED_IMAGE_SIMPLE} />,
        }}
      />
    </div>
  );
}
