import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { Input, Button, Typography, Spin, Result } from "antd";
import { LockOutlined } from "@ant-design/icons";
import MarkdownRenderer from "../components/MarkdownRenderer.js";

const { Title, Text } = Typography;

interface SharedContent {
  entityType: string;
  title: string;
  content: string;
  sharedBy: string;
  sharedAt: string;
  expiresAt: string | null;
}

export default function SharedView() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<SharedContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requiresPassword, setRequiresPassword] = useState(false);
  const [password, setPassword] = useState("");

  const fetchContent = async (pwd?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/s/${token}${pwd ? `?password=${encodeURIComponent(pwd)}` : ""}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body.requiresPassword) {
          setRequiresPassword(true);
          setLoading(false);
          return;
        }
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json);
      setRequiresPassword(false);
    } catch (e: any) {
      setError(e.message || "加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) fetchContent();
  }, [token]);

  const handlePasswordSubmit = () => {
    if (!password.trim()) return;
    fetchContent(password);
  };

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}>
        <Spin size="large" />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ maxWidth: 600, margin: "80px auto" }}>
        <Result status="error" title="无法访问" subTitle={error} />
      </div>
    );
  }

  if (requiresPassword) {
    return (
      <div style={{ maxWidth: 400, margin: "120px auto", textAlign: "center" }}>
        <LockOutlined style={{ fontSize: 40, color: "#1677ff", marginBottom: 16 }} />
        <Title level={4}>需要访问密码</Title>
        <Text type="secondary" style={{ display: "block", marginBottom: 16 }}>
          此分享链接需要输入密码才能查看
        </Text>
        <Input.Password
          size="large"
          placeholder="输入访问密码"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onPressEnter={handlePasswordSubmit}
          style={{ marginBottom: 12 }}
        />
        <Button type="primary" size="large" block onClick={handlePasswordSubmit}>
          查看
        </Button>
      </div>
    );
  }

  if (!data) return null;

  const entityLabel = data.entityType === "wiki" ? "知识库文章" : data.entityType === "ticket" ? "攻关单" : "公告";

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "40px 24px" }}>
      <div style={{ marginBottom: 24 }}>
        <Title level={3} style={{ marginBottom: 4 }}>
          {data.title}
        </Title>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <Text type="secondary">
            来自 <Text strong>{data.sharedBy}</Text> 的{entityLabel}分享
          </Text>
          <Text type="secondary">分享于 {new Date(data.sharedAt).toLocaleString()}</Text>
          {data.expiresAt && <Text type="secondary">过期时间: {new Date(data.expiresAt).toLocaleString()}</Text>}
        </div>
      </div>
      <div
        className="markdown-body"
        style={{
          padding: 24,
          border: "1px solid #f0f0f0",
          borderRadius: 8,
          background: "#fff",
          minHeight: 200,
        }}
      >
        <MarkdownRenderer>{data.content || "*暂无内容*"}</MarkdownRenderer>
      </div>
      <div style={{ textAlign: "center", marginTop: 32, opacity: 0.5 }}>
        <Text type="secondary">由作战管理平台提供</Text>
      </div>
    </div>
  );
}
