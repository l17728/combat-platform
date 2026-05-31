import { useCallback, useEffect, useState } from "react";
import { Button, Card, Empty, Select, Space, Table, Tag, Tooltip, Typography, message } from "antd";
import { CheckOutlined, ReloadOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import "dayjs/locale/zh-cn";
import type { ColumnsType } from "antd/es/table";
import { api, type InboxNotification } from "../api.js";
import {
  NOTIFICATION_KIND_COLOR,
  NOTIFICATION_KIND_LABEL,
  PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  DATE_FORMAT_FULL,
} from "../constants.js";
import HelpButton from "../components/HelpButton.js";
import HELP from "../help-content.js";

dayjs.locale("zh-cn");
dayjs.extend(relativeTime);

const { Title } = Typography;

type ReadFilter = "all" | "unread" | "read";

export default function NotificationsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<InboxNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [kindFilter, setKindFilter] = useState<string | undefined>();
  const [readFilter, setReadFilter] = useState<ReadFilter>("all");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.listNotifications({ limit: 200 });
      setItems(r.items);
    } catch {
      message.error("加载通知失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const onRowClick = async (n: InboxNotification) => {
    if (!n.readAt) {
      try {
        await api.markNotificationRead(n.id);
        setItems((arr) => arr.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
      } catch {
        /* ignore */
      }
    }
    if (n.link) navigate(n.link);
  };

  const onMarkAll = async () => {
    try {
      const r = await api.markAllNotificationsRead();
      message.success(`已标记 ${r.updated} 条为已读`);
      const now = new Date().toISOString();
      setItems((arr) => arr.map((x) => ({ ...x, readAt: x.readAt ?? now })));
    } catch {
      message.error("操作失败");
    }
  };

  const filtered = items.filter((n) => {
    if (kindFilter && n.kind !== kindFilter) return false;
    if (readFilter === "unread" && n.readAt) return false;
    if (readFilter === "read" && !n.readAt) return false;
    return true;
  });

  const columns: ColumnsType<InboxNotification> = [
    {
      title: "状态",
      key: "readState",
      width: 70,
      render: (_, n) => (n.readAt ? <Tag>已读</Tag> : <Tag color="blue">未读</Tag>),
    },
    {
      title: "类型",
      key: "kind",
      width: 100,
      render: (_, n) => (
        <Tag color={NOTIFICATION_KIND_COLOR[n.kind] ?? "default"}>{NOTIFICATION_KIND_LABEL[n.kind] ?? n.kind}</Tag>
      ),
    },
    {
      title: "标题",
      dataIndex: "title",
      key: "title",
      ellipsis: true,
      render: (v, n) => (
        <a onClick={() => onRowClick(n)} style={{ fontWeight: n.readAt ? 400 : 600 }}>
          {v}
        </a>
      ),
    },
    {
      title: "内容",
      dataIndex: "body",
      key: "body",
      ellipsis: true,
      render: (v: string | null) => v ?? "—",
    },
    {
      title: "时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 140,
      defaultSortOrder: "descend",
      sorter: (a, b) => dayjs(a.createdAt).valueOf() - dayjs(b.createdAt).valueOf(),
      render: (v: string) => <Tooltip title={dayjs(v).format(DATE_FORMAT_FULL)}>{dayjs(v).fromNow()}</Tooltip>,
    },
  ];

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <Title level={4} style={{ margin: 0 }}>
          通知中心
          <HelpButton title={HELP.notifications.title} content={HELP.notifications.content} />
        </Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetchAll}>
            刷新
          </Button>
          <Button
            type="primary"
            icon={<CheckOutlined />}
            onClick={onMarkAll}
            disabled={items.every((n) => n.readAt)}
            data-testid="notifications-mark-all"
          >
            全部标已读
          </Button>
        </Space>
      </div>

      <Card size="small" style={{ marginBottom: 12 }}>
        <Space wrap>
          <Select
            allowClear
            placeholder="按类型筛选"
            value={kindFilter}
            onChange={setKindFilter}
            style={{ width: 160 }}
            options={Object.entries(NOTIFICATION_KIND_LABEL).map(([v, l]) => ({ value: v, label: l }))}
            data-testid="filter-kind"
          />
          <Select
            value={readFilter}
            onChange={setReadFilter}
            style={{ width: 140 }}
            options={[
              { value: "all", label: "全部" },
              { value: "unread", label: "仅未读" },
              { value: "read", label: "仅已读" },
            ]}
            data-testid="filter-read"
          />
        </Space>
      </Card>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={filtered}
        columns={columns}
        size="middle"
        pagination={{
          pageSize: PAGE_SIZE,
          showSizeChanger: true,
          pageSizeOptions: PAGE_SIZE_OPTIONS.map(String),
          showTotal: (t) => `共 ${t} 条`,
        }}
        locale={{ emptyText: <Empty description="暂无通知" /> }}
        data-testid="notifications-table"
      />
    </div>
  );
}
