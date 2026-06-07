import { useEffect, useState, useCallback, useRef } from "react";
import { Typography, Card, Button, Space, Spin, Empty, Statistic, Row, Col } from "antd";
import { ReloadOutlined, FullscreenOutlined } from "@ant-design/icons";
import mermaid from "mermaid";
import { api } from "../api.js";
import HelpButton from "../components/HelpButton.js";
import HELP from "../help-content.js";
import { handleApiError } from "../utils/handleApiError.js";

const { Title, Text } = Typography;

mermaid.initialize({ startOnLoad: false, theme: "default" });

export default function ResponsibilityDiagram() {
  const [data, setData] = useState<{ mermaid: string; nodeCount: number; edgeCount: number } | null>(null);
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

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <Space>
          <Title level={4} style={{ margin: 0 }}>
            责任图谱
          </Title>
          <HelpButton
            title={HELP.responsibilityDiagram?.title ?? "责任图谱"}
            content={HELP.responsibilityDiagram?.content ?? ""}
          />
        </Space>
        <Space>
          <Button icon={<FullscreenOutlined />} onClick={handleFullscreen}>
            全屏
          </Button>
          <Button icon={<ReloadOutlined />} onClick={fetchData}>
            刷新
          </Button>
        </Space>
      </div>

      {data && (
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={8}>
            <Card size="small">
              <Statistic title="节点数" value={data.nodeCount} />
            </Card>
          </Col>
          <Col span={8}>
            <Card size="small">
              <Statistic title="关系数" value={data.edgeCount} />
            </Card>
          </Col>
        </Row>
      )}

      <Card size="small">
        {loading ? (
          <div style={{ textAlign: "center", padding: 40 }}>
            <Spin size="large" />
            <div style={{ marginTop: 12 }}>
              <Text type="secondary">正在生成责任图谱...</Text>
            </div>
          </div>
        ) : error ? (
          <Empty description={`加载失败：${error}`}>
            <Button onClick={fetchData}>重试</Button>
          </Empty>
        ) : !data || data.nodeCount === 0 ? (
          <Empty description="暂无责任数据，需在系统中配置升级规则和人员分配" />
        ) : (
          <div
            ref={containerRef}
            style={{
              overflow: "auto",
              padding: 16,
              minHeight: 400,
              display: "flex",
              justifyContent: "center",
            }}
          />
        )}
      </Card>
    </div>
  );
}
