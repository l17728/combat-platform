import { useEffect, useState } from 'react';
import {
  Typography,
  Card,
  Form,
  Input,
  InputNumber,
  Button,
  Switch,
  message,
  Skeleton,
  Space,
  Table,
  Modal,
  Popconfirm,
} from 'antd';
import { api } from '../api.js';
import type { SmtpConfigMasked, GraphNode } from '@combat/shared';
import HelpButton from '../components/HelpButton.js';
import HELP from '../help-content.js';

const { Title, Text } = Typography;

export default function EmailSettings() {
  const [config, setConfig] = useState<SmtpConfigMasked | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [form] = Form.useForm();

  const [groups, setGroups] = useState<GraphNode[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [groupSaving, setGroupSaving] = useState(false);
  const [editingGroup, setEditingGroup] = useState<GraphNode | null>(null);
  const [groupForm] = Form.useForm();

  useEffect(() => {
    api
      .getEmailConfig()
      .then((c) => {
        setConfig(c);
        form.setFieldsValue({
          host: c.host,
          port: c.port,
          secure: c.secure,
          username: c.username,
          password: '',
          fromEmail: c.fromEmail,
          fromName: c.fromName ?? '',
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const fetchGroups = async () => {
    setGroupsLoading(true);
    try {
      const list = await api.listNodes('emailGroup');
      setGroups(list);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setGroupsLoading(false);
    }
  };

  useEffect(() => {
    fetchGroups();
  }, []);

  const openCreateGroup = () => {
    setEditingGroup(null);
    groupForm.resetFields();
    setGroupModalOpen(true);
  };

  const openEditGroup = (node: GraphNode) => {
    setEditingGroup(node);
    groupForm.setFieldsValue(node.properties);
    setGroupModalOpen(true);
  };

  const handleGroupSubmit = async (values: Record<string, unknown>) => {
    setGroupSaving(true);
    try {
      if (editingGroup) {
        await api.updateNode(editingGroup.id, values);
        message.success('群组更新成功');
      } else {
        await api.createNode('emailGroup', values);
        message.success('群组创建成功');
      }
      setGroupModalOpen(false);
      groupForm.resetFields();
      await fetchGroups();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setGroupSaving(false);
    }
  };

  const handleGroupDelete = async (id: string) => {
    try {
      await api.deleteNode(id);
      message.success('群组删除成功');
      await fetchGroups();
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const handleSave = async (values: Record<string, unknown>) => {
    setSaving(true);
    try {
      await api.putEmailConfig({
        host: values.host,
        port: values.port,
        secure: values.secure,
        username: values.username,
        password: values.password,
        fromEmail: values.fromEmail,
        fromName: values.fromName,
      } as any);
      message.success('保存成功');
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!testEmail) {
      message.warning('请输入测试收件人');
      return;
    }
    setTesting(true);
    try {
      const result = await api.testEmail(testEmail);
      if (result.ok) {
        message.success('测试邮件发送成功');
      } else {
        message.error(`发送失败: ${result.error ?? '未知错误'}`);
      }
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setTesting(false);
    }
  };

  if (loading) return <Skeleton active paragraph={{ rows: 6 }} />;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
        <Title level={4} style={{ margin: 0 }}>邮件设置</Title>
        <HelpButton title={HELP.emailSettings.title} content={HELP.emailSettings.content} />
      </div>

      <Card style={{ maxWidth: 600 }}>
        <Form form={form} layout="vertical" onFinish={handleSave}
          initialValues={{ port: 465, secure: true }}>
          <Form.Item name="host" label="SMTP 服务器"
            rules={[{ required: true, message: '请输入 SMTP 服务器地址' }]}>
            <Input placeholder="例如: smtp.qq.com" />
          </Form.Item>
          <Space style={{ width: '100%' }} direction="horizontal" size="large">
            <Form.Item name="port" label="端口"
              rules={[{ required: true, message: '请输入端口' }]}>
              <InputNumber placeholder="465" min={1} max={65535} style={{ width: 160 }} />
            </Form.Item>
            <Form.Item name="secure" label="SSL/TLS" valuePropName="checked"
              tooltip="端口 465 通常启用 SSL，端口 587 通常关闭">
              <Switch checkedChildren="SSL" unCheckedChildren="OFF" />
            </Form.Item>
          </Space>
          <Form.Item name="username" label="用户名（邮箱地址）"
            rules={[{ required: true, message: '请输入邮箱地址' }]}>
            <Input placeholder="例如: 3657768344@qq.com" />
          </Form.Item>
          <Form.Item name="password" label="密码 / 授权码"
            rules={config?.passwordSet ? [] : [{ required: true, message: '请输入密码或授权码' }]}>
            <Input.Password placeholder={config?.passwordSet ? '留空保持原密码不变' : 'QQ邮箱请使用授权码'} />
          </Form.Item>
          <Form.Item name="fromEmail" label="发件人邮箱"
            rules={[{ required: true, message: '请输入发件人邮箱' }]}>
            <Input placeholder="与用户名相同，例如: 3657768344@qq.com" />
          </Form.Item>
          <Form.Item name="fromName" label="发件人名称（可选）">
            <Input placeholder="例如: 作战管理平台" />
          </Form.Item>
          {config?.passwordSet && !form.getFieldValue('password') && (
            <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
              密码已保存。留空则保持原密码不变。
            </Text>
          )}
          <Space>
            <Button type="primary" htmlType="submit" loading={saving}>
              保存配置
            </Button>
          </Space>
        </Form>

        <div style={{ marginTop: 24, borderTop: '1px solid #f0f0f0', paddingTop: 16 }}>
          <Space>
            <Input
              placeholder="收件人邮箱"
              style={{ width: 240 }}
              value={testEmail}
              onChange={e => setTestEmail(e.target.value)}
            />
            <Button onClick={handleTest} loading={testing}>
              发送测试邮件
            </Button>
          </Space>
        </div>
      </Card>

      <Card style={{ marginTop: 24, maxWidth: 900 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <Title level={5} style={{ margin: 0 }}>邮件群组</Title>
          <Button type="primary" onClick={openCreateGroup}>新建群组</Button>
        </div>
        <Table<GraphNode>
          rowKey="id"
          size="small"
          loading={groupsLoading}
          dataSource={groups}
          pagination={{ pageSize: 10, showTotal: (t) => `共 ${t} 条` }}
          columns={[
            {
              title: '组名',
              dataIndex: ['properties', '组名'],
              render: (_: unknown, node) => String(node.properties['组名'] ?? ''),
            },
            {
              title: '成员邮箱',
              dataIndex: ['properties', '成员邮箱'],
              ellipsis: true,
              render: (_: unknown, node) => String(node.properties['成员邮箱'] ?? ''),
            },
            {
              title: '描述',
              dataIndex: ['properties', '描述'],
              ellipsis: true,
              render: (_: unknown, node) => String(node.properties['描述'] ?? ''),
            },
            {
              title: '操作',
              width: 120,
              render: (_: unknown, node) => (
                <Space size="middle">
                  <a onClick={() => openEditGroup(node)}>编辑</a>
                  <Popconfirm title="确认删除该群组？" onConfirm={() => handleGroupDelete(node.id)}>
                    <a style={{ color: '#ff4d4f' }}>删除</a>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title={editingGroup ? '编辑群组' : '新建群组'}
        open={groupModalOpen}
        onCancel={() => setGroupModalOpen(false)}
        onOk={() => groupForm.submit()}
        confirmLoading={groupSaving}
        destroyOnClose
        okText="保存"
        cancelText="取消"
      >
        <Form form={groupForm} layout="vertical" onFinish={handleGroupSubmit}>
          <Form.Item name="组名" label="组名"
            rules={[{ required: true, message: '请输入组名' }]}>
            <Input placeholder="例如: 领导组" />
          </Form.Item>
          <Form.Item name="成员邮箱" label="成员邮箱">
            <Input.TextArea rows={3} placeholder="多个邮箱用逗号分隔，如 a@x.com, b@x.com" />
          </Form.Item>
          <Form.Item name="描述" label="描述">
            <Input placeholder="可选" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
