import { useEffect, useState, useCallback } from 'react';
import {
  Table,
  Button,
  Space,
  Input,
  Select,
  Drawer,
  Form,
  message,
  Popconfirm,
  Upload,
  Typography,
  Skeleton,
} from 'antd';
import { PlusOutlined, UploadOutlined, ExportOutlined, SearchOutlined } from '@ant-design/icons';
import { api } from '../api.js';
import { PAGE_SIZE } from '../constants.js';
import type { GraphNode } from '@combat/shared';

const { Title } = Typography;

export default function PeopleList() {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [deptFilter, setDeptFilter] = useState<string | undefined>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.listNodes('person');
      setNodes(list);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const departments = [...new Set(nodes.map((n) => n.properties['部门'] as string).filter(Boolean))];

  const filtered = nodes.filter((n) => {
    const p = n.properties;
    if (deptFilter && p['部门'] !== deptFilter) return false;
    if (searchText) {
      const s = searchText.toLowerCase();
      return (
        (p['姓名'] as string)?.toLowerCase().includes(s) ||
        (p['邮箱'] as string)?.toLowerCase().includes(s) ||
        (p['工号'] as string)?.toLowerCase().includes(s)
      );
    }
    return true;
  });

  const handleCreate = async (values: Record<string, unknown>) => {
    setSubmitting(true);
    try {
      await api.createNode('person', values);
      message.success('添加成功');
      setDrawerOpen(false);
      form.resetFields();
      fetchData();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteNode(id);
      message.success('删除成功');
      fetchData();
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const handleExport = async () => {
    try {
      const blob = await api.exportNodes('person');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '全员名单.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const handleImport = async (file: File) => {
    try {
      const result = await api.importXlsx(file, 'person');
      message.success(`导入完成：新增 ${result.created}，更新 ${result.updated}`);
      setImportOpen(false);
      fetchData();
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const columns = [
    {
      title: '姓名',
      dataIndex: ['properties', '姓名'],
      width: 100,
      render: (v: string) => v || '-',
    },
    {
      title: '工号',
      dataIndex: ['properties', '工号'],
      width: 100,
    },
    {
      title: '邮箱',
      dataIndex: ['properties', '邮箱'],
      ellipsis: true,
    },
    {
      title: '部门',
      dataIndex: ['properties', '部门'],
      width: 120,
    },
    {
      title: '角色',
      dataIndex: ['properties', '角色'],
      width: 100,
    },
    {
      title: '操作',
      width: 80,
      render: (_: unknown, r: GraphNode) => (
        <Popconfirm
          title={`确认删除「${r.properties['姓名'] ?? ''}」？`}
          onConfirm={() => handleDelete(r.id)}
        >
          <a style={{ color: '#ff4d4f' }}>删除</a>
        </Popconfirm>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          全员名单
        </Title>
        <Space>
          <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>
            导入名单
          </Button>
          <Button icon={<ExportOutlined />} onClick={handleExport}>
            导出
          </Button>
          <Button icon={<PlusOutlined />} type="primary" onClick={() => setDrawerOpen(true)}>
            添加
          </Button>
        </Space>
      </div>

      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          placeholder="部门筛选"
          allowClear
          style={{ width: 140 }}
          value={deptFilter}
          onChange={setDeptFilter}
          options={departments.map((d) => ({ value: d, label: d }))}
        />
        <Input
          placeholder="搜索姓名/邮箱/工号"
          prefix={<SearchOutlined />}
          style={{ width: 240 }}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          allowClear
        />
      </Space>

      {loading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : (
        <Table
          rowKey="id"
          dataSource={filtered}
          columns={columns}
          pagination={{ pageSize: PAGE_SIZE, showSizeChanger: false, showTotal: (t) => `共 ${t} 条` }}
          size="middle"
        />
      )}

      <Drawer
        title="添加人员"
        width={480}
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          form.resetFields();
        }}
        extra={
          <Button type="primary" loading={submitting} onClick={() => form.submit()}>
            添加
          </Button>
        }
      >
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="姓名" label="姓名" rules={[{ required: true }]}>
            <Input placeholder="姓名" />
          </Form.Item>
          <Form.Item name="工号" label="工号">
            <Input placeholder="工号" />
          </Form.Item>
          <Form.Item name="邮箱" label="邮箱">
            <Input placeholder="邮箱地址" />
          </Form.Item>
          <Form.Item name="部门" label="部门">
            <Input placeholder="部门" />
          </Form.Item>
          <Form.Item name="角色" label="角色">
            <Input placeholder="角色" />
          </Form.Item>
        </Form>
      </Drawer>

      <Drawer
        title="导入全员名单"
        width={480}
        open={importOpen}
        onClose={() => setImportOpen(false)}
      >
        <div style={{ marginBottom: 16 }}>
          <Button onClick={handleExport} size="small">
            下载模板
          </Button>
        </div>
        <Upload.Dragger
          accept=".xlsx,.xls"
          showUploadList={false}
          customRequest={({ file }) => handleImport(file as File)}
        >
          <p className="ant-upload-text">点击或拖拽 Excel 文件到此处</p>
          <p className="ant-upload-hint">支持 .xlsx / .xls 格式</p>
        </Upload.Dragger>
      </Drawer>
    </div>
  );
}
