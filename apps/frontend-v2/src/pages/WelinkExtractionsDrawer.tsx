import { useEffect, useMemo, useState, useCallback } from "react";
import {
  Drawer,
  Tabs,
  Empty,
  Button,
  Space,
  Tag,
  Popconfirm,
  Tooltip,
  Typography,
  Skeleton,
  message,
  Alert,
} from "antd";
import { UserAddOutlined, CheckCircleOutlined, DeleteOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { api, type WelinkExtraction, type WelinkExtractionKind } from "../api.js";

const { Text, Paragraph } = Typography;

const KIND_LABEL: Record<WelinkExtractionKind, string> = {
  entity: "人物",
  event: "时间线",
  decision: "决策",
  dispute: "争议",
  gap: "缺口",
};

const KIND_COLOR: Record<WelinkExtractionKind, string> = {
  entity: "blue",
  event: "cyan",
  decision: "green",
  dispute: "orange",
  gap: "gold",
};

interface Props {
  open: boolean;
  ticketId: string;
  onClose: () => void;
  onMembersChanged?: () => void;
}

function renderPayload(payload: any): React.ReactNode {
  if (payload == null) return <Text type="secondary">(无详情)</Text>;
  if (typeof payload === "string") return <span>{payload}</span>;
  return (
    <pre
      style={{
        background: "#fafafa",
        padding: 8,
        borderRadius: 4,
        fontSize: 12,
        margin: 0,
        whiteSpace: "pre-wrap",
        wordBreak: "break-all",
      }}
    >
      {JSON.stringify(payload, null, 2)}
    </pre>
  );
}

export default function WelinkExtractionsDrawer({ open, ticketId, onClose, onMembersChanged }: Props) {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<WelinkExtraction[]>([]);
  const [activeKind, setActiveKind] = useState<WelinkExtractionKind>("entity");
  const [addingName, setAddingName] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    try {
      const r = await api.listWelinkExtractions(ticketId);
      setItems(r.items);
    } catch (e: any) {
      message.error(`加载抽取结果失败: ${e.message || e}`);
    } finally {
      setLoading(false);
    }
  }, [ticketId, open]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const grouped = useMemo(() => {
    const g: Record<WelinkExtractionKind, WelinkExtraction[]> = {
      entity: [],
      event: [],
      decision: [],
      dispute: [],
      gap: [],
    };
    for (const it of items) {
      if (it.kind in g) g[it.kind as WelinkExtractionKind].push(it);
    }
    return g;
  }, [items]);

  const handleMarkReviewed = async (id: string) => {
    try {
      await api.updateWelinkExtraction(ticketId, id, { reviewed: true });
      setItems((arr) => arr.map((it) => (it.id === id ? { ...it, reviewed: true } : it)));
      message.success("已标记为已查阅");
    } catch (e: any) {
      message.error(`标记失败: ${e.message || e}`);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteWelinkExtraction(ticketId, id);
      setItems((arr) => arr.filter((it) => it.id !== id));
      message.success("已删除");
    } catch (e: any) {
      message.error(`删除失败: ${e.message || e}`);
    }
  };

  const handleAddMember = async (name: string) => {
    if (!name) return;
    setAddingName(name);
    try {
      const r = await api.welinkAddMembers(ticketId, [name]);
      if (r.added > 0) {
        message.success(`已加入「${name}」`);
      } else {
        message.info(`「${name}」已在成员列表`);
      }
      onMembersChanged?.();
    } catch (e: any) {
      message.error(`加入失败: ${e.message || e}`);
    } finally {
      setAddingName(null);
    }
  };

  const renderItem = (it: WelinkExtraction) => {
    const name = it.payload?.name || it.label;
    const isGap = it.kind === "gap";
    const isEntityWithName = it.kind === "entity" && !!name;
    return (
      <div
        key={it.id}
        data-testid="welink-extraction-item"
        data-kind={it.kind}
        style={{
          padding: 12,
          marginBottom: 8,
          border: "1px solid #f0f0f0",
          borderRadius: 6,
          background: it.reviewed ? "#fafafa" : "#fff",
          opacity: it.reviewed ? 0.65 : 1,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
          <Space size={6}>
            <Tag color={KIND_COLOR[it.kind as WelinkExtractionKind]}>{KIND_LABEL[it.kind as WelinkExtractionKind]}</Tag>
            <Text strong>{it.label}</Text>
            {it.reviewed && <Tag color="green">已查阅</Tag>}
          </Space>
          <Tooltip title={new Date(it.createdAt).toLocaleString()}>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {new Date(it.createdAt).toLocaleString().slice(5)}
            </Text>
          </Tooltip>
        </div>
        <div style={{ marginBottom: 8 }}>{renderPayload(it.payload)}</div>
        <Space wrap size={4}>
          {(isGap || isEntityWithName) && (
            <Button
              size="small"
              type="primary"
              icon={<UserAddOutlined />}
              loading={addingName === name}
              onClick={() => handleAddMember(name)}
              data-testid="welink-add-member-btn"
            >
              加入攻关成员
            </Button>
          )}
          {!it.reviewed && (
            <Button size="small" icon={<CheckCircleOutlined />} onClick={() => handleMarkReviewed(it.id)}>
              标已查阅
            </Button>
          )}
          <Popconfirm title="确认删除该条抽取?" onConfirm={() => handleDelete(it.id)}>
            <Button size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      </div>
    );
  };

  const tabItems = (Object.keys(KIND_LABEL) as WelinkExtractionKind[]).map((k) => ({
    key: k,
    label: (
      <span>
        {KIND_LABEL[k]}{" "}
        <Tag style={{ marginLeft: 4 }} color={KIND_COLOR[k]}>
          {grouped[k].length}
        </Tag>
      </span>
    ),
    children: (
      <div data-testid={`welink-extraction-tab-${k}`}>
        {grouped[k].length === 0 ? (
          <Empty description={`暂无${KIND_LABEL[k]}抽取项`} image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          grouped[k].map(renderItem)
        )}
      </div>
    ),
  }));

  return (
    <Drawer
      title={
        <Space>
          <ThunderboltOutlined style={{ color: "#faad14" }} />
          <span>AI 抽取结果</span>
          <Tag color="blue">{items.length}</Tag>
        </Space>
      }
      width={520}
      open={open}
      onClose={onClose}
      destroyOnClose
      maskClosable={false}
      extra={
        <Button onClick={refresh} loading={loading} size="small">
          刷新
        </Button>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="对群消息跑「让 AI 分析」后,这里展示按类别归档的抽取项;「缺口」「人物」可一键加入攻关成员。"
      />
      {loading && items.length === 0 ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : items.length === 0 ? (
        <Empty
          description={
            <Paragraph type="secondary" style={{ margin: 0 }}>
              暂无抽取结果。回 Welink Tab 点击「让 AI 分析」开始抽取。
            </Paragraph>
          }
        />
      ) : (
        <Tabs activeKey={activeKind} onChange={(k) => setActiveKind(k as WelinkExtractionKind)} items={tabItems} />
      )}
    </Drawer>
  );
}
