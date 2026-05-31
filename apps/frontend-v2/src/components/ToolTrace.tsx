import { useState } from "react";
import { Tag, Typography, Space, Alert } from "antd";
import {
  ToolOutlined,
  RightOutlined,
  DownOutlined,
  ThunderboltOutlined,
  ApiOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import type { HermesTraceStep } from "../api.js";

const { Text } = Typography;

/**
 * 工具调用过程可视化:在 AI 答复气泡里以可折叠时间线方式展示
 *  - engine='tool' (蓝色 工具调用) / 'intent' (灰色 规则路由) badge
 *  - trace[] 每步: 工具图标 + 名 + 入参 size + 出参 size + 耗时 + 截断徽标
 *  - 每步可二次展开为 JSON code block
 *  - fallback_reason 显示为黄色警告
 *
 * 优雅降级: 上游 trace?.length > 0 才挂载本组件;后端旧 response 不带 trace 时不渲染。
 */
function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

function fmtJson(x: unknown): string {
  try {
    return JSON.stringify(x, null, 2);
  } catch {
    return String(x);
  }
}

export interface ToolTraceProps {
  trace: HermesTraceStep[];
  engine?: "tool" | "intent";
  fallbackReason?: string;
}

export default function ToolTrace({ trace, engine, fallbackReason }: ToolTraceProps) {
  const [open, setOpen] = useState(false);
  const [stepOpen, setStepOpen] = useState<Record<number, boolean>>({});

  const hasTrace = !!trace && trace.length > 0;
  if (!hasTrace && !fallbackReason && !engine) return null;

  const totalMs = hasTrace ? trace.reduce((s, t) => s + (t.ms || 0), 0) : 0;
  const engineBadge =
    engine === "tool" ? (
      <Tag color="blue" icon={<ThunderboltOutlined />} data-testid="hermes-engine-badge" style={{ marginInlineEnd: 0 }}>
        工具调用
      </Tag>
    ) : engine === "intent" ? (
      <Tag color="default" icon={<ApiOutlined />} data-testid="hermes-engine-badge" style={{ marginInlineEnd: 0 }}>
        规则路由
      </Tag>
    ) : null;

  return (
    <div style={{ marginTop: 8 }}>
      <Space size={6} style={{ marginBottom: 4 }} wrap>
        {engineBadge}
      </Space>

      {fallbackReason && (
        <Alert
          type="warning"
          showIcon
          icon={<WarningOutlined />}
          message={fallbackReason}
          data-testid="hermes-fallback-reason"
          style={{ padding: "4px 8px", fontSize: 12, marginBottom: 6 }}
        />
      )}

      {hasTrace && (
        <div
          data-testid="hermes-trace-header"
          onClick={() => setOpen((v) => !v)}
          style={{
            cursor: "pointer",
            padding: "4px 8px",
            background: "#fafafa",
            border: "1px solid #f0f0f0",
            borderRadius: 4,
            fontSize: 12,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {open ? <DownOutlined style={{ fontSize: 10 }} /> : <RightOutlined style={{ fontSize: 10 }} />}
          <ToolOutlined style={{ color: "#1677ff" }} />
          <Text style={{ fontSize: 12 }}>
            工具调用 ({trace.length} 步,共 {totalMs}ms)
          </Text>
        </div>
      )}

      {open && hasTrace && (
        <div
          style={{
            marginTop: 6,
            paddingLeft: 8,
            borderLeft: "2px solid #e5e7eb",
          }}
        >
          {trace.map((step, idx) => {
            const expanded = !!stepOpen[idx];
            return (
              <div
                key={idx}
                data-testid={`hermes-trace-step-${idx}`}
                style={{ marginBottom: 6, fontSize: 12, lineHeight: 1.6 }}
              >
                <div
                  data-testid="hermes-trace-step-toggle"
                  onClick={() => setStepOpen((s) => ({ ...s, [idx]: !s[idx] }))}
                  style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}
                >
                  {expanded ? <DownOutlined style={{ fontSize: 10 }} /> : <RightOutlined style={{ fontSize: 10 }} />}
                  <Text style={{ fontSize: 11, color: "#666" }}>#{idx + 1}</Text>
                  <Tag color="geekblue" style={{ marginInlineEnd: 0 }}>
                    <ToolOutlined /> {step.tool}
                  </Tag>
                  <Tag color="default" style={{ marginInlineEnd: 0 }}>
                    出 {fmtBytes(step.outputSize || 0)}
                  </Tag>
                  {step._truncated && (
                    <Tag color="orange" style={{ marginInlineEnd: 0 }}>
                      截断
                    </Tag>
                  )}
                  <Tag
                    color={step.ms > 1000 ? "red" : step.ms > 500 ? "orange" : "green"}
                    style={{ marginInlineEnd: 0 }}
                  >
                    {step.ms}ms
                  </Tag>
                </div>
                {expanded && (
                  <pre
                    style={{
                      margin: "4px 0 0 18px",
                      padding: 6,
                      background: "#0f172a",
                      color: "#e5e7eb",
                      borderRadius: 4,
                      fontSize: 11,
                      maxHeight: 200,
                      overflow: "auto",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                    }}
                  >
                    {`tool: ${step.tool}\ninput: ${fmtJson(step.input)}\noutputSize: ${step.outputSize}\nms: ${step.ms}${
                      step._truncated ? "\n_truncated: true" : ""
                    }`}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
