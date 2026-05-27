import { useEffect, useState, useCallback } from 'react';
import {
  Typography, Table, Button, Space, Modal, Form, Input, Select, message, Popconfirm, Tag, Skeleton,
} from 'antd';
import { PlusOutlined, UserOutlined } from '@ant-design/icons';
import { api, type AuthUser } from '../api.js';
import { useAuth } from '../hooks/useAuth.js';
import HelpButton from '../components/HelpButton.js';
import HELP from '../help-content.js';
import { PAGE_SIZE, PAGE_SIZE_OPTIONS } from '../constants.js';

const { Title } = Typography;

const ROLE_OPTIONS = [
  { value: 'normal', label: '普通成员' },
  { value: 'leader', label: 'Leader' },
  { value: 'admin', label: '管理员' },
];

const ROLE_COLOR: Record<string, string> = {
  admin: 'red',
  leader: 'blue',
  normal: 'default',
};

export default function UserManagement() {
  const { isAdmin } = useAuth();
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AuthUser | null>(null);
  const [addForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [editSubmitting, setEditSubmitting] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.listUsers();
      setUsers(list);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isAdmin) fetchData(); }, [isAdmin, fetchData]);

  if (!isAdmin) {
    return (
      <div>
        <Title level={4}>用户管理</Title>
        <p>仅管理员可访问此页面</p>
      </div>
    );
  }

  const handleAdd = async (values: { username: string; password: string; displayName?: string; role?: string }) => {
    setAddSubmitting(true);
    try {
      await api.createUser(values);
      message.success('用户已创建');
      setAddOpen(false);
      addForm.resetFields();
      fetchData();
    } catch (e: any) { message.error(e.message); }
    finally { setAddSubmitting(false); }
  };

  const handleEdit = async (values: { role?: string; displayName?: string; password?: string }) => {
    if (!editingUser) return;
    setEditSubmitting(true);
    const data: Record<string, string> = {};
    if (values.role) data.role = values.role;
    if (values.displayName) data.displayName = values.displayName;
    if (values.password) data.password = values.password;
    try {
      await api.updateUser(editingUser.id, data);
      message.success('用户已更新');
      setEditOpen(false);
      setEditingUser(null);
      fetchData();
    } catch (e: any) { message.error(e.message); }
    finally { setEditSubmitting(false); }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteUser(id);
      message.success('用户已删除');
      fetchData();
    } catch (e: any) { message.error(e.message); }
  };

  const columns = [
    { title: '用户名', dataIndex: 'username', width: 120, ellipsis: true },
    { title: '显示名', dataIndex: 'displayName', ellipsis: true },
    {
      title: '角色', dataIndex: 'role', width: 100,
      render: (v: string) => <Tag color={ROLE_COLOR[v] ?? 'default'}>{ROLE_OPTIONS.find(r => r.value === v)?.label ?? v}</Tag>,
    },
    { title: '创建时间', dataIndex: 'createdAt', width: 160, render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : '-' },
    {
      title: '操作', width: 120, render: (_: unknown, r: AuthUser) => (
        <Space>
          <a onClick={() => { setEditingUser(r); editForm.setFieldsValue({ role: r.role, displayName: r.displayName }); setEditOpen(true); }}>编辑</a>
          <Popconfirm title="确认删除此用户？" onConfirm={() => handleDelete(r.id)}>
            <a style={{ color: '#ff4d4f' }}>删除</a>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <UserOutlined style={{ fontSize: 20 }} />
          <Title level={4} style={{ margin: 0 }}>用户管理</Title>
          <HelpButton title={HELP.userManagement?.title ?? ''} content={HELP.userManagement?.content ?? ''} />
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>新建用户</Button>
      </div>

      {loading ? <Skeleton active paragraph={{ rows: 6 }} /> : (
        <Table rowKey="id" dataSource={users} columns={columns} size="middle"
          pagination={{ pageSize: PAGE_SIZE, showSizeChanger: true, pageSizeOptions: PAGE_SIZE_OPTIONS, showTotal: (t) => `共 ${t} 条` }}
         />
      )}

      <Modal title="新建用户" open={addOpen} onCancel={() => { setAddOpen(false); addForm.resetFields(); }} destroyOnClose
        footer={null}>
        <Form form={addForm} layout="vertical" onFinish={handleAdd}>
          <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input placeholder="2-32个字符" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }, { min: 6, message: '至少6个字符' }]}>
            <Input.Password placeholder="至少6个字符" />
          </Form.Item>
          <Form.Item name="displayName" label="显示名">
            <Input placeholder="可选" />
          </Form.Item>
          <Form.Item name="role" label="角色" initialValue="normal">
            <Select options={ROLE_OPTIONS} />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
            <Space>
              <Button onClick={() => { setAddOpen(false); addForm.resetFields(); }}>取消</Button>
              <Button type="primary" htmlType="submit" loading={addSubmitting}>创建</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      <Modal title={`编辑用户: ${editingUser?.username ?? ''}`} open={editOpen} onCancel={() => { setEditOpen(false); setEditingUser(null); }} destroyOnClose
        footer={null}>
        <Form form={editForm} layout="vertical" onFinish={handleEdit}>
          <Form.Item name="displayName" label="显示名">
            <Input placeholder="显示名" />
          </Form.Item>
          <Form.Item name="role" label="角色">
            <Select options={ROLE_OPTIONS} />
          </Form.Item>
          <Form.Item name="password" label="重置密码">
            <Input.Password placeholder="留空则不修改" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
            <Space>
              <Button onClick={() => { setEditOpen(false); setEditingUser(null); }}>取消</Button>
              <Button type="primary" htmlType="submit" loading={editSubmitting}>保存</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
