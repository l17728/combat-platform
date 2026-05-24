import { useEffect, useState } from 'react';
import {
  Typography,
  Card,
  Form,
  Input,
  Button,
  message,
  Spin,
  Space,
} from 'antd';
import { api } from '../api.js';
import type { SmtpConfigMasked } from '@combat/shared';

const { Title } = Typography;

export default function EmailSettings() {
  const [config, setConfig] = useState<SmtpConfigMasked | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => {
    api
      .getEmailConfig()
      .then((c) => {
        setConfig(c);
        form.setFieldsValue(c as any);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (values: Record<string, unknown>) => {
    setSaving(true);
    try {
      await api.putEmailConfig(values as any);
      message.success('保存成功');
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    const to = form.getFieldValue('testEmail');
    if (!to) {
      message.warning('请输入测试收件人');
      return;
    }
    setTesting(true);
    try {
      await api.testEmail(to);
      message.success('测试邮件已发送');
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setTesting(false);
    }
  };

  if (loading) return <Spin size="large" style={{ display: 'block', marginTop: 100 }} />;

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>
        邮件设置
      </Title>

      <Card style={{ maxWidth: 600 }}>
        <Form form={form} layout="vertical" onFinish={handleSave}>
          <Form.Item name="host" label="SMTP 服务器">
            <Input placeholder="smtp.example.com" />
          </Form.Item>
          <Form.Item name="port" label="端口">
            <Input placeholder="465" />
          </Form.Item>
          <Form.Item name="user" label="用户名">
            <Input placeholder="发件人邮箱" />
          </Form.Item>
          <Form.Item name="pass" label="密码">
            <Input.Password placeholder="••••••" />
          </Form.Item>
          <Form.Item name="from" label="发件人">
            <Input placeholder="发件人名称 <email@example.com>" />
          </Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={saving}>
              保存配置
            </Button>
          </Space>
        </Form>

        <div style={{ marginTop: 24, borderTop: '1px solid #f0f0f0', paddingTop: 16 }}>
          <Form layout="inline">
            <Form.Item name="testEmail" label="发送测试邮件">
              <Input placeholder="收件人邮箱" style={{ width: 240 }} />
            </Form.Item>
            <Button onClick={handleTest} loading={testing}>
              发送
            </Button>
          </Form>
        </div>
      </Card>
    </div>
  );
}
