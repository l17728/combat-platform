import { useEffect, useState, useCallback, useRef } from "react";
import { Typography, Card, Button, Space, Spin, Empty, Statistic, Row, Col, Table, Tabs, Tag } from "antd";
import { ReloadOutlined, FullscreenOutlined } from "@ant-design/icons";
import mermaid from "mermaid";
import { api } from "../api.js";
import HelpButton from "../components/HelpButton.js";
import HELP from "../help-content.js";
import { handleApiError } from "../utils/handleApiError.js";

const { Title, Text } = Typography;

mermaid.initialize({ startOnLoad: false, theme: "default" });

type DiagramData = Awaited<ReturnType<typeof api.getResponsibilityDiagram>>;

export default function ResponsibilityDiagram() {
  const [data, setData] = useState<DiagramData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getResponsibilityDiagram();
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!data?.mermaid || !containerRef.current) return;
    const renderDiagram = async () => {
      try {
        const id = `mermaid-${Date.now()}`;
        const { svg } = await mermaid.render(id, data.mermaid);
        if (containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      } catch {
        if (containerRef.current) {
          containerRef.current.innerHTML = `<pre style="color:#999;font-size:12px;white-space:pre-wrap">${data.mermaid}</pre>`;
        }
      }
    };
    renderDiagram();
  }, [data?.mermaid]);

  const handleFullscreen = () => {
    const el = containerRef.current?.parentElement;
    if (el?.requestFullscreen) el.requestFullscreen();
  };

  const personColumns = [
    { title: "人员", dataIndex: "name", key: "name", width: 150 },
    { title: "分配任务", dataIndex: "assignedCount", key: "assignedCount", width: 100, sorter: (a: DiagramData["personLoads"][0], b: DiagramData["personLoads"][0]) => a.assignedCount - b.assignedCount },
    { title: "上报任务", dataIndex: "escalatedCount", key: "escalatedCount", width: 100 },
    {
      title: "冲突数",
      dataIndex: "conflictCount",
      key: "conflictCount",
      width: 100,
      sorter: (a: DiagramData["personLoads"][0], b: DiagramData["personLoads"][0]) => a.conflictCount - b.conflictCount,
      render: (v: number) => v > 0 ? <Tag color="red">{v}</Tag> : <Tag>0</Tag>,
    },
  ];

  const conflictColumns = [
    { title: "任务 A", dataIndex: "ticketA", key: "ticketA" },
    { title: "", key: "arrow", width: 40, render: () => "↔" },
    { title: "任务 B", dataIndex: "ticketB", key: "ticketB" },
  ];

  const ruleColumns = [
    { title: "事件级别", dataIndex: "level", key: "level", width: 100, render: (v: string) => <Tag color={v === "P1" ? "red" : v === "P2" ? "orange" : "blue"}>{v}</Tag> },
    { title: "SLA", dataIndex: "slaHours", key: "slaHours", width: 80, render: (v: number) => `${v}h` },
    { title: "上升角色", dataIndex: "role", key: "role" },
    { title: "关联任务数", dataIndex: "ticketCount", key: "ticketCount", width: 100 },
  ];

  const tabItems = [
    {
      key: "overview",
      label: "概览图",
      children: (
        <Card size="small">
          {loading ? (
            <div style={{ textAlign: "center", padding: 40 }}>
              <Spin size="large" />
              <div style={{ marginTop: 12 }}><Text type="secondary">正在生成责任图谱...</Text></div>
            </div>
          ) : error ? (
            <Empty description={`加载失败：${error}`}>
              <Button onClick={fetchData}>重试</Button>
            </Empty>
          ) : !data || data.nodeCount === 0 ? (
            <Empty description="暂无责任数据，需在系统中配置升级规则和人员分配" />
          ) : (
            <div ref={containerRef} style={{ overflow: "auto", padding: 16, minHeight: 400, display: "flex", justifyContent: "center" }} />
          )}
        </Card>
      ),
    },
    {
      key: "person-load",
      label: `人员负载 (${data?.totalPersons ?? 0})`,
      children: (
        <Card size="small">
          <Table
            dataSource={data?.personLoads ?? []}
            columns={personColumns}
            rowKey="personId"
            size="small"
            pagination={{ pageSize: 15, showSizeChanger: false }}
            scroll={{ y: 500 }}
          />
        </Card>
      ),
    },
    {
      key: "conflicts",
      label: `冲突关系 (${data?.totalConflicts ?? 0})`,
      children: (
        <Card size="small">
          {data && data.totalConflicts > 0 ? (
            <Table
              dataSource={data.conflictTop}
              columns={conflictColumns}
              rowKey={(_, i) => String(i)}
              size="small"
              pagination={{ pageSize: 15, showSizeChanger: false }}
              scroll={{ y: 500 }}
            />
          ) : (
            <Empty description="暂无冲突关系" />
          )}
        </Card>
      ),
    },
    {
      key: "rules",
      label: "升级规则",
      children: (
        <Card size="small">
          <Table
            dataSource={data?.escalationRules ?? []}
            columns={ruleColumns}
            rowKey="level"
            size="small"
            pagination={false}
          />
        </Card>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <Space>
          <Title level={4} style={{ margin: 0 }}>责任图谱</Title>
          <HelpButton title={HELP.responsibilityDiagram?.title ?? "责任图谱"} content={HELP.responsibilityDiagram?.content ?? ""} />
        </Space>
        <Space>
          <Button icon={<FullscreenOutlined />} onClick={handleFullscreen}>全屏</Button>
          <Button icon={<ReloadOutlined />} onClick={fetchData}>刷新</Button>
        </Space>
      </div>

      {data && (
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={6}><Card size="small"><Statistic title="任务总数" value={data.totalTickets} /></Card></Col>
          <Col span={6}><Card size="small"><Statistic title="人员总数" value={data.totalPersons} /></Card></Col>
          <Col span={6}><Card size="small"><Statistic title="冲突组数" value={data.totalConflicts} valueStyle={data.totalConflicts > 0 ? { color: "#cf1322" } : undefined} /></Card></Col>
          <Col span={6}><Card size="small"><Statistic title="升级规则" value={data.escalationRules.length} suffix="条" /></Card></Col>
        </Row>
      )}

      <Tabs items={tabItems} defaultActiveKey="overview" />
    </div>
  );
}
