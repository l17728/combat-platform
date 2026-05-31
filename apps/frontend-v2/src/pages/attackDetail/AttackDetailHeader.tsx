import {
  Typography,
  Button,
  Space,
  Card,
  Descriptions,
  Steps,
  Alert,
  Tag,
  Tooltip,
  Popconfirm,
  Popover,
  Checkbox,
} from "antd";
import {
  ArrowLeftOutlined,
  EditOutlined,
  SwapOutlined,
  DeleteOutlined,
  LinkOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ThunderboltOutlined,
  MinusCircleOutlined,
  SyncOutlined,
  AppstoreOutlined,
  LockOutlined,
  UnlockOutlined,
} from "@ant-design/icons";
import { Link, useNavigate } from "react-router-dom";
import HelpButton from "../../components/HelpButton.js";
import HELP from "../../help-content.js";
import StatusTag from "../../components/StatusTag.js";
import { DATE_FORMAT } from "../../constants.js";
import dayjs from "dayjs";
import type { GraphNode, NodeSchema, FieldSchema } from "@combat/shared";

const { Title, Text } = Typography;

const STATUS_STEPS = ["待响应", "处理中", "进行中", "已解决", "已关闭"];
const STATUS_STEP_ICON: Record<string, React.ReactNode> = {
  待响应: <ClockCircleOutlined />,
  处理中: <SyncOutlined />,
  进行中: <ThunderboltOutlined />,
  已解决: <CheckCircleOutlined />,
  已关闭: <MinusCircleOutlined />,
};
function getStatusStepIndex(status: string): number {
  return STATUS_STEPS.indexOf(status);
}

export interface AttackDetailHeaderProps {
  node: GraphNode;
  schema: NodeSchema | null;
  id: string;
  authUsername?: string;
  isCreator: boolean;
  isPrivate: boolean;
  visibleCards: string[];
  sidebarCardOptions: { key: string; label: string }[];
  onVisibleCardsChange: (vals: string[]) => void;
  onOpenPrivacyDrawer: () => void;
  onCancelPrivacy: () => void;
  onOpenTransition: () => void;
  onOpenEdit: () => void;
  onDelete: () => void;
}

export default function AttackDetailHeader(props: AttackDetailHeaderProps) {
  const navigate = useNavigate();
  const {
    node,
    schema,
    id,
    authUsername,
    isCreator,
    isPrivate,
    visibleCards,
    sidebarCardOptions,
    onVisibleCardsChange,
    onOpenPrivacyDrawer,
    onCancelPrivacy,
    onOpenTransition,
    onOpenEdit,
    onDelete,
  } = props;

  const p = node.properties;
  const status = String(p["状态"] ?? "");
  const title = String(p["标题"] ?? id.slice(0, 8));
  const currentStep = getStatusStepIndex(status);

  const missingFields =
    schema?.fields.filter((f: FieldSchema) => !f.retired && f.required && !p[f.name]?.toString().trim()) ?? [];

  const summaryItems = [
    { label: "问题单号", value: p["问题单号"] },
    { label: "事件单号", value: p["事件单号"] },
    { label: "事件级别", value: p["事件级别"] },
    { label: "客户名称", value: p["客户名称"] },
    { label: "当前处理人", value: p["当前处理人"] },
    { label: "攻关组长", value: p["攻关组长"] },
    { label: "故障发生时间", value: p["故障发生时间"] },
    { label: "影响及现存风险", value: p["影响及现存风险"] },
  ].filter((item) => item.value);

  const creator = String(p["创建人"] ?? "").trim();
  const canDelete = !!creator && !!authUsername && creator === authUsername;

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <Button
          type="link"
          icon={<ArrowLeftOutlined />}
          onClick={() => {
            const idx = (window.history.state && (window.history.state as any).idx) as number | undefined;
            if (idx && idx > 0) navigate(-1);
            else navigate("/attack");
          }}
          style={{ paddingLeft: 0 }}
        >
          返回列表
        </Button>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 16,
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Title level={4} style={{ margin: 0 }}>
              {isPrivate && (
                <Tooltip title="私密攻关单 — 仅创建人/成员/授权人可访问">
                  <LockOutlined style={{ color: "#fa8c16", marginRight: 6 }} />
                </Tooltip>
              )}
              {title} <StatusTag status={status} />
            </Title>
            <HelpButton title={HELP.attackDetail.title} content={HELP.attackDetail.content} />
          </div>
          <Text type="secondary">
            创建于 {dayjs(node.createdAt).format(DATE_FORMAT)} · 更新于 {dayjs(node.updatedAt).fromNow()}
          </Text>
        </div>
        <Space>
          <Popover
            trigger="click"
            placement="bottomRight"
            content={
              <div style={{ minWidth: 180 }}>
                <Checkbox.Group
                  value={visibleCards}
                  onChange={(vals) => onVisibleCardsChange(vals as string[])}
                  style={{ display: "flex", flexDirection: "column", gap: 8 }}
                >
                  {sidebarCardOptions.map((opt) => (
                    <Checkbox key={opt.key} value={opt.key}>
                      {opt.label}
                    </Checkbox>
                  ))}
                </Checkbox.Group>
              </div>
            }
          >
            <Button icon={<AppstoreOutlined />}>面板</Button>
          </Popover>
          <Link to={`/related/attackTicket/${id}`}>
            <Button icon={<LinkOutlined />}>关联全景</Button>
          </Link>
          {isCreator &&
            (isPrivate ? (
              <>
                <Button icon={<LockOutlined />} onClick={onOpenPrivacyDrawer}>
                  管理私密授权
                </Button>
                <Popconfirm title="确认取消私密?所有人都将能访问该攻关单" onConfirm={onCancelPrivacy}>
                  <Button icon={<UnlockOutlined />}>取消私密</Button>
                </Popconfirm>
              </>
            ) : (
              <Button icon={<LockOutlined />} onClick={onOpenPrivacyDrawer}>
                设置私密
              </Button>
            ))}
          <Button icon={<SwapOutlined />} onClick={onOpenTransition}>
            状态流转
          </Button>
          <Button icon={<EditOutlined />} onClick={onOpenEdit}>
            编辑信息
          </Button>
          {canDelete && (
            <Popconfirm title="确认删除此攻关单？" onConfirm={onDelete}>
              <Button danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          )}
        </Space>
      </div>

      {missingFields.length > 0 && (
        <Alert
          type="warning"
          message={`以下必填信息尚未填写：${missingFields.map((f) => f.label).join("、")}`}
          description="请点击编辑补充完整"
          showIcon
          style={{ marginBottom: 16 }}
          closable
        />
      )}

      <Card size="small" style={{ marginBottom: 16 }}>
        <Steps
          size="small"
          current={currentStep}
          items={STATUS_STEPS.map((s, i) => ({
            title: s,
            icon: STATUS_STEP_ICON[s],
            status: i < currentStep ? "finish" : i === currentStep ? "process" : "wait",
          }))}
        />
      </Card>

      {summaryItems.length > 0 && (
        <Card size="small" style={{ marginBottom: 16 }}>
          <Descriptions column={3} size="small">
            {summaryItems.map((item) => (
              <Descriptions.Item key={String(item.label)} label={String(item.label)}>
                {item.label === "影响及现存风险" ? (
                  <Tooltip title={String(item.value)}>
                    <span>
                      {String(item.value).length > 40 ? String(item.value).slice(0, 40) + "…" : String(item.value)}
                    </span>
                  </Tooltip>
                ) : (
                  String(item.value)
                )}
              </Descriptions.Item>
            ))}
          </Descriptions>
        </Card>
      )}
    </>
  );
}

export { STATUS_STEPS, STATUS_STEP_ICON, getStatusStepIndex };
// 兼容 ts:Tag 未使用占位
void Tag;
