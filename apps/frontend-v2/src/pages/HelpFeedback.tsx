import { useEffect, useState } from "react";
import { ConfigProvider, Typography, Card, Form, Input, Button, Spin, message, Descriptions, Result } from "antd";
import zhCN from "antd/locale/zh_CN";
import { useParams } from "react-router-dom";
import HelpButton from "../components/HelpButton.js";
import HELP from "../help-content.js";

const { Title } = Typography;

export default function HelpFeedback() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [info, setInfo] = useState<any>(null);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form] = Form.useForm();

  useEffect(() => {
    if (!token) return;
    fetch(`/api/help/feedback/${token}`)
      .then((r) => {
        if (!r.ok) throw new Error("无法加载");
        return r.json();
      })
      .then(setInfo)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  const handleSubmit = async (values: { feedback: string; name?: string }) => {
    if (!token) return;
    setSubmitting(true);
    try {
      const r = await fetch(`/api/help/feedback/${token}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!r.ok) throw new Error("提交失败");
      message.success("反馈已提交");
      setSubmitted(true);
    } catch (e) {
      message.error((e instanceof Error ? e.message : String(e)) || "提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  const content = (() => {
    if (loading) {
      return (
        <div style={{ maxWidth: 600, margin: "80px auto", textAlign: "center" }}>
          <Spin size="large" />
        </div>
      );
    }

    if (error) {
      return (
        <div style={{ maxWidth: 600, margin: "80px auto", padding: "0 24px" }}>
          <Result status="error" title="加载失败" subTitle={error} />
        </div>
      );
    }

    return (
      <div style={{ maxWidth: 600, margin: "40px auto", padding: "0 24px" }}>
        <Card>
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <Title level={3} style={{ margin: 0 }}>
                攻关求助反馈
              </Title>
              <HelpButton title={HELP.helpFeedback.title} content={HELP.helpFeedback.content} />
            </div>
          </div>

          {info && (
            <Descriptions column={1} style={{ marginBottom: 24 }}>
              <Descriptions.Item label="攻关单">{info.ticketTitle ?? "-"}</Descriptions.Item>
              <Descriptions.Item label="求助人">{info.requesterName ?? "-"}</Descriptions.Item>
              <Descriptions.Item label="求助内容">{info.question ?? "-"}</Descriptions.Item>
            </Descriptions>
          )}

          {submitted ? (
            <Result status="success" title="反馈已提交，感谢您的帮助！" />
          ) : (
            <Form form={form} layout="vertical" onFinish={handleSubmit}>
              <Form.Item name="feedback" label="反馈内容" rules={[{ required: true, message: "请输入反馈内容" }]}>
                <Input.TextArea rows={6} placeholder="请填写您的回复..." />
              </Form.Item>
              <Form.Item name="name" label="您的姓名（可选）">
                <Input placeholder="姓名" />
              </Form.Item>
              <Button type="primary" htmlType="submit" loading={submitting} block size="large">
                提交反馈
              </Button>
            </Form>
          )}
        </Card>
      </div>
    );
  })();

  return <ConfigProvider locale={zhCN}>{content}</ConfigProvider>;
}
