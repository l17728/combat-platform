import { useEffect, useState } from 'react';
import { Typography, Card, Form, Input, Button, Spin, message, Descriptions } from 'antd';
import { useParams } from 'react-router-dom';

const { Title, Text, Paragraph } = Typography;

export default function HelpFeedback() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [info, setInfo] = useState<any>(null);
  const [submitted, setSubmitted] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => {
    if (!token) return;
    fetch(`/api/help/feedback/${token}`)
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => message.error('无法加载求助信息'))
      .finally(() => setLoading(false));
  }, [token]);

  const handleSubmit = async (values: { feedback: string; name?: string }) => {
    if (!token) return;
    setSubmitting(true);
    try {
      const r = await fetch(`/api/help/feedback/${token}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (!r.ok) throw new Error('提交失败');
      message.success('反馈已提交');
      setSubmitted(true);
    } catch (e: any) {
      message.error(e.message || '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ maxWidth: 600, margin: '80px auto' }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 600, margin: '80px auto', padding: '0 24px' }}>
      <Card>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Title level={3}>攻关求助反馈</Title>
        </div>

        {info && (
          <Descriptions column={1} style={{ marginBottom: 24 }}>
            <Descriptions.Item label="攻关单">{info.ticketTitle ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="求助人">{info.requesterName ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="求助内容">{info.question ?? '-'}</Descriptions.Item>
          </Descriptions>
        )}

        {submitted ? (
          <div style={{ textAlign: 'center', padding: 24 }}>
            <Title level={4} style={{ color: '#52c41a' }}>反馈已提交，感谢您的帮助！</Title>
          </div>
        ) : (
          <Form form={form} layout="vertical" onFinish={handleSubmit}>
            <Form.Item
              name="feedback"
              label="反馈内容"
              rules={[{ required: true, message: '请输入反馈内容' }]}
            >
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
}
