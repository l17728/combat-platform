import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Dropdown, Empty, List, Tag, Tooltip, Typography, message } from "antd";
import { BellOutlined, CheckOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import "dayjs/locale/zh-cn";
import { api, type InboxNotification } from "../api.js";
import { NOTIFICATION_KIND_COLOR, NOTIFICATION_KIND_LABEL } from "../constants.js";

dayjs.locale("zh-cn");
dayjs.extend(relativeTime);

const POLL_MS = 30_000;

function tagFor(kind: string) {
  return (
    <Tag color={NOTIFICATION_KIND_COLOR[kind] ?? "default"} style={{ marginRight: 0 }}>
      {NOTIFICATION_KIND_LABEL[kind] ?? kind}
    </Tag>
  );
}

export default function NotificationBell() {
  const [items, setItems] = useState<InboxNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const sseRef = useRef<EventSource | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchList = useCallback(async () => {
    try {
      const r = await api.listNotifications({ limit: 10 });
      setItems(r.items);
      setUnreadCount(r.unreadCount);
    } catch {
      /* silent */
    }
  }, []);

  useEffect(() => {
    fetchList();

    // 优先 SSE 实时推;失败回落到 30s 轮询。
    try {
      const es = new EventSource("/api/notifications/stream", { withCredentials: true });
      sseRef.current = es;
      es.addEventListener("notification", () => {
        fetchList();
      });
      es.onerror = () => {
        es.close();
        sseRef.current = null;
        if (!pollRef.current) {
          pollRef.current = setInterval(fetchList, POLL_MS);
        }
      };
    } catch {
      pollRef.current = setInterval(fetchList, POLL_MS);
    }

    // 始终保留一个低频轮询兜底 (SSE 之外 90s 一跑,避免推送丢包)
    const safety = setInterval(fetchList, POLL_MS * 3);

    return () => {
      sseRef.current?.close();
      sseRef.current = null;
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      clearInterval(safety);
    };
  }, [fetchList]);

  const onClickItem = async (n: InboxNotification) => {
    setOpen(false);
    if (!n.readAt) {
      try {
        await api.markNotificationRead(n.id);
        setUnreadCount((c) => Math.max(0, c - 1));
        setItems((arr) => arr.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
      } catch {
        /* ignore */
      }
    }
    if (n.link) navigate(n.link);
  };

  const onMarkAll = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.markAllNotificationsRead();
      setUnreadCount(0);
      setItems((arr) => arr.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })));
      message.success("已全部标为已读");
    } catch {
      message.error("操作失败");
    }
  };

  const dropdownContent = (
    <div
      data-testid="notification-dropdown"
      style={{
        width: 360,
        maxHeight: 480,
        background: "#fff",
        borderRadius: 8,
        boxShadow: "0 6px 16px 0 rgba(0,0,0,0.08), 0 3px 6px -4px rgba(0,0,0,0.12)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid #f0f0f0",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Typography.Text strong>通知中心</Typography.Text>
        <Button
          type="link"
          size="small"
          icon={<CheckOutlined />}
          disabled={unreadCount === 0}
          onClick={onMarkAll}
          data-testid="notification-mark-all"
        >
          全部已读
        </Button>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {items.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无通知" style={{ padding: 24 }} />
        ) : (
          <List
            size="small"
            dataSource={items}
            renderItem={(n) => (
              <List.Item
                data-testid="notification-item"
                style={{
                  cursor: "pointer",
                  padding: "8px 12px",
                  background: n.readAt ? "transparent" : "#e6f4ff",
                }}
                onClick={() => onClickItem(n)}
              >
                <div style={{ width: "100%" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <Typography.Text strong style={{ flex: 1 }} ellipsis>
                      {n.title}
                    </Typography.Text>
                    {tagFor(n.kind)}
                  </div>
                  {n.body && (
                    <Typography.Paragraph
                      type="secondary"
                      ellipsis={{ rows: 2 }}
                      style={{ margin: "4px 0 0", fontSize: 12 }}
                    >
                      {n.body}
                    </Typography.Paragraph>
                  )}
                  <Tooltip title={dayjs(n.createdAt).format("YYYY-MM-DD HH:mm:ss")}>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                      {dayjs(n.createdAt).fromNow()}
                    </Typography.Text>
                  </Tooltip>
                </div>
              </List.Item>
            )}
          />
        )}
      </div>
      <div
        style={{
          borderTop: "1px solid #f0f0f0",
          padding: 8,
          textAlign: "center",
          background: "#fafafa",
        }}
      >
        <Button
          type="link"
          size="small"
          onClick={() => {
            setOpen(false);
            navigate("/notifications");
          }}
          data-testid="notification-view-all"
        >
          查看全部
        </Button>
      </div>
    </div>
  );

  return (
    <Dropdown
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) fetchList();
      }}
      trigger={["click"]}
      placement="bottomRight"
      dropdownRender={() => dropdownContent}
    >
      <Badge count={unreadCount} size="small" offset={[-2, 2]} data-testid="notification-badge">
        <Button
          type="text"
          icon={<BellOutlined style={{ fontSize: 18 }} />}
          data-testid="notification-bell"
          aria-label="通知中心"
        />
      </Badge>
    </Dropdown>
  );
}
