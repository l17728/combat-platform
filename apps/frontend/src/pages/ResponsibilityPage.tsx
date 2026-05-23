import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Space, Typography, Spin, Alert, Tag } from "antd";

const API_BASE = "";

let _mermaidInitialized = false;

interface DiagramData {
  mermaid: string;
  nodeCount: number;
  edgeCount: number;
}

export function ResponsibilityPage() {
  const [data, setData] = useState<DiagramData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgContent, setSvgContent] = useState<string>("");

  const fetchDiagram = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSvgContent("");
    try {
      const res = await fetch(`${API_BASE}/api/responsibility/diagram`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: DiagramData = await res.json();
      setData(json);
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchDiagram();
  }, [fetchDiagram]);

  // Render Mermaid whenever data changes (dynamic import keeps mermaid in its own chunk)
  useEffect(() => {
    if (!data?.mermaid) return;
    let cancelled = false;
    (async () => {
      try {
        const { default: mermaid } = await import("mermaid");
        if (!_mermaidInitialized) {
          mermaid.initialize({ startOnLoad: false, theme: "default" });
          _mermaidInitialized = true;
        }
        const id = `resp-diagram-${Date.now()}`;
        const { svg } = await mermaid.render(id, data.mermaid);
        if (!cancelled) setSvgContent(svg);
      } catch (e) {
        if (!cancelled) setError(`Mermaid 渲染失败: ${(e as Error).message}`);
      }
    })();
    return () => { cancelled = true; };
  }, [data]);

  return (
    <div style={{ padding: 16 }}>
      <Typography.Title level={3}>责任矩阵 · 关系图</Typography.Title>

      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" onClick={fetchDiagram} loading={loading}>
          重新生成
        </Button>
        {data && (
          <>
            <Tag color="blue">节点: {data.nodeCount}</Tag>
            <Tag color="green">边: {data.edgeCount}</Tag>
          </>
        )}
      </Space>

      {error && (
        <Alert
          type="error"
          message={error}
          style={{ marginBottom: 16 }}
          closable
          onClose={() => setError(null)}
        />
      )}

      {loading && (
        <div style={{ textAlign: "center", padding: 40 }}>
          <Spin size="large" tip="生成中…" />
        </div>
      )}

      {!loading && svgContent && (
        <div
          ref={containerRef}
          aria-label="responsibility-diagram"
          style={{
            background: "#fff",
            border: "1px solid #f0f0f0",
            borderRadius: 8,
            padding: 16,
            overflowX: "auto",
          }}
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: svgContent }}
        />
      )}

      {!loading && !error && !svgContent && !data && (
        <Typography.Text type="secondary">暂无数据</Typography.Text>
      )}

      {!loading && data?.mermaid && !svgContent && !error && (
        <div>
          <Typography.Text type="secondary" style={{ display: "block", marginBottom: 8 }}>
            Mermaid 源码:
          </Typography.Text>
          <pre
            style={{
              background: "#f5f5f5",
              padding: 12,
              borderRadius: 4,
              fontSize: 12,
              overflowX: "auto",
            }}
          >
            {data.mermaid}
          </pre>
        </div>
      )}
    </div>
  );
}
