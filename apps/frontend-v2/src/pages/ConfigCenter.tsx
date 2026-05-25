import { useEffect, useState, useCallback } from 'react';
import {
  Typography, Table, Button, Space, Input, Modal, Form, message, Popconfirm, Tag, Empty, Skeleton,
} from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { api } from '../api.js';
import { PAGE_SIZE, PAGE_SIZE_OPTIONS } from '../constants.js';
import HelpButton from '../components/HelpButton.js';
import HELP from '../help-content.js';

const { Title, Text } = Typography;

interface SettingEntry {
  key: string;
  values: string[];
  label?: string;
}

export default function ConfigCenter() {
  const [settings, setSettings] = useState<Record<string, { values: string[]; label?: string }>>({});
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingKey, setEditingKey] = useState('');
  const [addForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [searchText, setSearchText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try { setSettings(await api.listSettings()); }
    catch (e: any) { message.error(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const entries: SettingEntry[] = Object.entries(settings)
    .filter(([key]) => !key.includes('.'))
    .map(([key, val]) => ({ key, ...val }))
    .filter(e => !searchText || e.key.toLowerCase().includes(searchText.toLowerCase()) || e.label?.includes(searchText));

  const handleAdd = async (values: { key: string; label?: string; valuesText: string }) => {
    const vals = values.valuesText.split(/[,，\n]/).map(s => s.trim()).filter(Boolean);
    if (vals.length === 0) { message.warning('请至少输入一个选项'); return; }
    setSubmitting(true);
    try {
      await api.setSetting(values.key, vals, values.label);
      message.success('配置已添加');
      setAddOpen(false);
      addForm.resetFields();
      fetchData();
    } catch (e: any) { message.error(e.message); }
    finally { setSubmitting(false); }
  };

  const handleEdit = async (values: { label?: string; valuesText: string }) => {
    const vals = values.valuesText.split(/[,，\n]/).map(s => s.trim()).filter(Boolean);
    if (vals.length === 0) { message.warning('请至少输入一个选项'); return; }
    setSubmitting(true);
    try {
      await api.setSetting(editingKey, vals, values.label);
      message.success('配置已更新');
      setEditOpen(false);
      fetchData();
    } catch (e: any) { message.error(e.message); }
    finally { setSubmitting(false); }
  };

  const handleDelete = async (key: string) => {
    try { await api.deleteSetting(key); message.success('配置已删除'); fetchData(); }
    catch (e: any) { message.error(e.message); }
  };

  const openEdit = (entry: SettingEntry) => {
    setEditingKey(entry.key);
    editForm.setFieldsValue({
      label: entry.label ?? '',
      valuesText: entry.values.join(', '),
    });
    setEditOpen(true);
  };

  const columns = [
    {
      title: '配置项', dataIndex: 'key', width: 220,
      render: (key: string, r: SettingEntry) => (
        <div>
          <Text strong code style={{ fontSize: 13 }}>{key}</Text>
          {r.label && <div><Text type="secondary" style={{ fontSize: 12 }}>{r.label}</Text></div>}
        </div>
      ),
    },
    {
      title: '可选值', dataIndex: 'values',
      render: (values: string[]) => (
        <Space wrap size={[4, 4]}>
          {values.map((v, i) => <Tag key={i}>{v}</Tag>)}
        </Space>
      ),
    },
    {
      title: '操作', width: 120, fixed: 'right' as const,
      render: (_: unknown, r: SettingEntry) => (
        <Space>
          <a onClick={() => openEdit(r)}>编辑</a>
          <Popconfirm title={`确认删除「${r.key}」？`} onConfirm={() => handleDelete(r.key)}>
            <a style={{ color: '#ff4d4f' }}>删除</a>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>配置中心</Title>
        <Space>
          <HelpButton title={HELP.configCenter.title} content={HELP.configCenter.content} />
          <Button icon={<ReloadOutlined />} onClick={fetchData}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>新增配置</Button>
        </Space>
      </div>

      <Space style={{ marginBottom: 16 }} wrap>
        <Input placeholder="搜索配置键名" style={{ width: 260 }} value={searchText}
          onChange={e => setSearchText(e.target.value)} allowClear />
      </Space>

      {loading ? <Skeleton active paragraph={{ rows: 6 }} /> : entries.length === 0 ? (
        <Empty description="暂无配置项" image={Empty.PRESENTED_IMAGE_SIMPLE}>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>新增配置</Button>
        </Empty>
      ) : (
        <Table rowKey="key" dataSource={entries} columns={columns}
          scroll={{ x: 'max-content' }}
          pagination={{ pageSize: PAGE_SIZE, showSizeChanger: true, pageSizeOptions: PAGE_SIZE_OPTIONS, showTotal: t => `共 ${t} 条` }}
          size="middle" />
      )}

      <Modal title="新增配置" open={addOpen} onCancel={() => { setAddOpen(false); addForm.resetFields(); }}
        footer={null} destroyOnClose>
        <Form form={addForm} layout="vertical" onFinish={handleAdd}>
          <Form.Item name="key" label="配置键" rules={[{ required: true, message: '请输入配置键' },
            { pattern: /^[a-zA-Z0-9\u4e00-\u9fff_.\-]+$/, message: '仅支持中文、字母、数字、下划线、点、短横线' }]}>
            <Input placeholder="例: 状态、事件级别、贡献类型" />
          </Form.Item>
          <Form.Item name="label" label="显示名（可选）">
            <Input placeholder="例: 攻关单状态" />
          </Form.Item>
          <Form.Item name="valuesText" label="可选值（逗号或换行分隔）" rules={[{ required: true, message: '请输入可选值' }]}>
            <Input.TextArea rows={4} placeholder="待响应, 处理中, 进行中, 已解决, 已关闭" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
            <Space>
              <Button onClick={() => { setAddOpen(false); addForm.resetFields(); }}>取消</Button>
              <Button type="primary" htmlType="submit" loading={submitting}>保存</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      <Modal title={`编辑配置: ${editingKey}`} open={editOpen} onCancel={() => setEditOpen(false)}
        footer={null} destroyOnClose>
        <Form form={editForm} layout="vertical" onFinish={handleEdit}>
          <Form.Item name="label" label="显示名（可选）">
            <Input placeholder="显示名" />
          </Form.Item>
          <Form.Item name="valuesText" label="可选值（逗号或换行分隔）" rules={[{ required: true, message: '请输入可选值' }]}>
            <Input.TextArea rows={6} placeholder="值1, 值2, 值3" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
            <Space>
              <Button onClick={() => setEditOpen(false)}>取消</Button>
              <Button type="primary" htmlType="submit" loading={submitting}>保存</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
