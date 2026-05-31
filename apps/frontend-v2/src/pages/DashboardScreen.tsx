import React, { useState, useEffect, useCallback, useRef } from "react";
import { Spin, Tag, Button, Tooltip } from "antd";
import { FullscreenOutlined, FullscreenExitOutlined, ReloadOutlined } from "@ant-design/icons";
import { api } from "../api.js";
import dayjs from "dayjs";

interface DashboardData {
  tickets: { total: number; open: number; resolved: number; byStatus: Record<string, string | number> };
  contributions: { total: number; topContributors: any[] };
  conflicts: { count: number; topReasons: string[] };
  today: { progressEntries: number; ticketsTouched: number };
  recentActivity: any[];
}

const STATUS_COLORS: Record<string, string> = {
  待响应: "#faad14",
  处理中: "#1890ff",
  进行中: "#13c2c2",
  已解决: "#52c41a",
  已关闭: "#8c8c8c",
};

const BG_COLORS = ["#1890ff", "#722ed1", "#13c2c2", "#faad14", "#52c41a", "#f5222d"];

export default function DashboardScreen() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  const fetchData = useCallback(async () => {
    try {
      const d = await api.getDashboard();
      setData(d);
    } catch {
      /* ignore */
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
    timerRef.current = setInterval(fetchData, 30000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchData]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  if (loading)
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
          background: "#0a1628",
        }}
      >
        <Spin size="large" />
      </div>
    );
  if (!data) return null;

  const { tickets, contributions, recentActivity } = data;
  const byStatus = tickets.byStatus as Record<string, number>;
  const total = tickets.total || 0;
  const statusEntries = Object.entries(byStatus).sort((a, b) => b[1] - a[1]);
  const contribTotal = contributions?.total || 0;

  return (
    <div
      ref={containerRef}
      style={{
        background: "linear-gradient(180deg, #0a1628 0%, #0d2137 50%, #0a1628 100%)",
        color: "#fff",
        minHeight: "100vh",
        padding: "24px 32px",
        fontFamily: "-apple-system, sans-serif",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 24,
          borderBottom: "1px solid rgba(255,255,255,0.1)",
          paddingBottom: 16,
        }}
      >
        <div>
          <h1 style={{ color: "#fff", margin: 0, fontSize: 28, fontWeight: 600 }}>作战态势大屏</h1>
          <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 14, marginTop: 4 }}>
            {dayjs().format("YYYY年MM月DD日 HH:mm")} · 每30秒自动刷新
          </div>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <Button icon={<ReloadOutlined />} ghost onClick={fetchData}>
            刷新
          </Button>
          <Tooltip title={isFullscreen ? "退出全屏" : "全屏模式"}>
            <Button
              icon={isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
              ghost
              onClick={toggleFullscreen}
            />
          </Tooltip>
        </div>
      </div>

      {/* KPI Row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
        {[
          { label: "攻关单总数", value: total, color: "#1890ff" },
          { label: "进行中", value: tickets.open, color: "#faad14" },
          { label: "已解决", value: tickets.resolved, color: "#52c41a" },
          { label: "贡献总数", value: contribTotal, color: "#722ed1" },
        ].map((card, i) => (
          <div
            key={i}
            style={{
              background: "rgba(255,255,255,0.05)",
              borderRadius: 8,
              padding: "20px 24px",
              border: `1px solid ${card.color}33`,
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: -20,
                right: -20,
                width: 80,
                height: 80,
                borderRadius: "50%",
                background: `${card.color}15`,
              }}
            />
            <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 14, marginBottom: 8 }}>{card.label}</div>
            <div style={{ fontSize: 42, fontWeight: 700, color: card.color, lineHeight: 1 }}>
              {typeof card.value === "number" ? card.value.toLocaleString() : card.value}
            </div>
          </div>
        ))}
      </div>

      {/* Main Content */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Status Distribution */}
        <div
          style={{
            background: "rgba(255,255,255,0.05)",
            borderRadius: 8,
            padding: 20,
            border: "1px solid rgba(255,255,255,0.1)",
          }}
        >
          <h3 style={{ color: "#fff", margin: "0 0 16px", fontSize: 16 }}>状态分布</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {statusEntries.map(([status, count], i) => {
              const pct = total > 0 ? (count / total) * 100 : 0;
              return (
                <div key={status}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 14 }}>{status}</span>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>
                      {count} ({pct.toFixed(1)}%)
                    </span>
                  </div>
                  <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: 4, height: 20, overflow: "hidden" }}>
                    <div
                      style={{
                        width: `${pct}%`,
                        height: "100%",
                        background: STATUS_COLORS[status] || BG_COLORS[i % BG_COLORS.length],
                        borderRadius: 4,
                        transition: "width 0.6s ease",
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent Activity */}
        <div
          style={{
            background: "rgba(255,255,255,0.05)",
            borderRadius: 8,
            padding: 20,
            border: "1px solid rgba(255,255,255,0.1)",
          }}
        >
          <h3 style={{ color: "#fff", margin: "0 0 16px", fontSize: 16 }}>最近活跃</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 320, overflow: "auto" }}>
            {(recentActivity || []).slice(0, 10).map((item: any, i: number) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "8px 12px",
                  background: "rgba(255,255,255,0.03)",
                  borderRadius: 6,
                }}
              >
                <div style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {String(item.properties?.["标题"] ?? item.id)}
                </div>
                <div style={{ marginLeft: 12, flexShrink: 0 }}>
                  <Tag color={STATUS_COLORS[String(item.properties?.["状态"] ?? "")] || "default"}>
                    {String(item.properties?.["状态"] ?? "-")}
                  </Tag>
                </div>
                <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 12, marginLeft: 12, flexShrink: 0 }}>
                  {dayjs(item.updatedAt).fromNow()}
                </div>
              </div>
            ))}
            {(!recentActivity || recentActivity.length === 0) && (
              <div style={{ color: "rgba(255,255,255,0.4)", textAlign: "center", padding: 20 }}>暂无数据</div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div
        style={{
          marginTop: 24,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderTop: "1px solid rgba(255,255,255,0.1)",
          paddingTop: 16,
        }}
      >
        <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 13 }}>
          人员总数：<span style={{ color: "#1890ff" }}>—</span> · 冲突：
          <span style={{ color: "#faad14" }}>{data.conflicts?.count ?? 0}</span>
        </div>
        <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 12 }}>作战管理平台 · 实时态势监控</div>
      </div>
    </div>
  );
}
