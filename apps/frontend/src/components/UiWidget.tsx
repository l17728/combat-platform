import { useEffect, useRef } from "react";
import { Table, Row, Col, Statistic, Card, Timeline, Tag, Typography } from "antd";
import type { UiSpec, UiTableParams, UiStatsParams, UiMermaidParams, UiTimelineParams, UiCardGridParams } from "@combat/shared";
import { Link } from "react-router-dom";

function TableWidget({ params }: { params: UiTableParams }) {
  const columns = params.columns.map(col => ({
    title: col, dataIndex: col, key: col,
    render: (v: unknown) => v != null ? String(v) : "-",
  }));
  return (
    <>
      {params.title && <Typography.Title level={5} style={{ marginBottom: 8 }}>{params.title}</Typography.Title>}
      <Table size="small" columns={columns} dataSource={params.rows.map((r, i) => ({ ...r, _key: i }))}
        rowKey="_key" pagination={{ pageSize: 10, size: "small" }} />
    </>
  );
}

function StatsWidget({ params }: { params: UiStatsParams }) {
  return (
    <>
      {params.title && <Typography.Title level={5} style={{ marginBottom: 8 }}>{params.title}</Typography.Title>}
      <Row gutter={[12, 12]}>
        {params.items.map((item, i) => (
          <Col key={i} xs={12} sm={8} md={6}>
            <Card size="small" style={{ textAlign: "center" }}>
              <Statistic title={item.label} value={item.value}
                valueStyle={{ color: item.color ?? "#1677ff", fontSize: 20 }} />
            </Card>
          </Col>
        ))}
      </Row>
    </>
  );
}

function MermaidWidget({ params }: { params: UiMermaidParams }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    import("mermaid").then(m => {
      if (cancelled || !ref.current) return;
      m.default.initialize({ startOnLoad: false, theme: "default", securityLevel: "loose" });
      m.default.render(`mermaid-widget-${Math.random().toString(36).slice(2)}`, params.diagram)
        .then(({ svg }) => { if (!cancelled && ref.current) ref.current.innerHTML = svg; })
        .catch(() => { if (!cancelled && ref.current) ref.current.textContent = params.diagram; });
    });
    return () => { cancelled = true; };
  }, [params.diagram]);
  return (
    <>
      {params.title && <Typography.Title level={5} style={{ marginBottom: 8 }}>{params.title}</Typography.Title>}
      <div ref={ref} style={{ overflowX: "auto" }} />
    </>
  );
}

function TimelineWidget({ params }: { params: UiTimelineParams }) {
  return (
    <>
      {params.title && <Typography.Title level={5} style={{ marginBottom: 8 }}>{params.title}</Typography.Title>}
      <Timeline items={params.items.map(item => ({
        label: item.time,
        children: (
          <div>
            <strong>{item.title}</strong>
            {item.status && <Tag style={{ marginLeft: 6 }}>{item.status}</Tag>}
            <div style={{ color: "#666", marginTop: 2 }}>{item.content}</div>
          </div>
        ),
      }))} />
    </>
  );
}

function CardGridWidget({ params }: { params: UiCardGridParams }) {
  return (
    <>
      {params.title && <Typography.Title level={5} style={{ marginBottom: 8 }}>{params.title}</Typography.Title>}
      <Row gutter={[12, 12]}>
        {params.cards.map((card, i) => (
          <Col key={i} xs={24} sm={12} md={8}>
            <Card size="small" title={card.link ? <Link to={card.link}>{card.title}</Link> : card.title}>
              {card.description && <Typography.Text type="secondary">{card.description}</Typography.Text>}
              {card.tags && card.tags.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  {card.tags.map((t, j) => <Tag key={j}>{t}</Tag>)}
                </div>
              )}
            </Card>
          </Col>
        ))}
      </Row>
    </>
  );
}

export function UiWidget({ spec }: { spec: UiSpec }) {
  switch (spec.widget) {
    case "TABLE": return <TableWidget params={spec.params as UiTableParams} />;
    case "STATS": return <StatsWidget params={spec.params as UiStatsParams} />;
    case "MERMAID": return <MermaidWidget params={spec.params as UiMermaidParams} />;
    case "TIMELINE": return <TimelineWidget params={spec.params as UiTimelineParams} />;
    case "CARD_GRID": return <CardGridWidget params={spec.params as UiCardGridParams} />;
    default: return <Typography.Text type="secondary">未知组件类型</Typography.Text>;
  }
}
