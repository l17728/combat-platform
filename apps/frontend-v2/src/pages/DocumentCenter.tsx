import { useEffect, useState, useCallback } from 'react';
import {
  Typography, Table, Button, Space, Tag, Empty, Skeleton, Upload, Modal, Form, Input, message, Popconfirm, Tooltip,
} from 'antd';
import { UploadOutlined, LinkOutlined, ReloadOutlined, CopyOutlined, DownloadOutlined } from '@ant-design/icons';
import type { UploadProps } from 'antd';
import { api, type DocItem } from '../api.js';
import { PAGE_SIZE, PAGE_SIZE_OPTIONS } from '../constants.js';
import { copyToClipboard } from '../utils/clipboard.js';
import { useAuth } from '../hooks/useAuth.js';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

function fmtSize(n: number | null): string {
  if (!n && n !== 0) return '-';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function DocumentCenter() {
  const { user } = useAuth();
  const uploader = user?.displayName || user?.username || undefined;
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkForm] = Form.useForm();
  const [linkSubmitting, setLinkSubmitting] = useState(false);

  const docUrl = (d: DocItem) =>
    d.type === 'link' ? (d.url ?? '') : `${window.location.origin}/api/documents/${d.id}/download`;

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    try { setDocs(await api.listDocuments()); }
    catch (e: any) { message.error(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  const uploadProps: UploadProps = {
    showUploadList: false,
    multiple: true,
    customRequest: async ({ file, onSuccess, onError }) => {
      setUploading(true);
      try {
        await api.uploadDocument(file as File, (file as File).name, uploader);
        onSuccess?.({});
        message.success(`「${(file as File).name}」已上传`);
        fetchDocs();
      } catch (e: any) {
        onError?.(e);
        message.error(e.message);
      } finally {
        setUploading(false);
      }
    },
  };

  const handleAddLink = async (values: { name: string; url: string }) => {
    setLinkSubmitting(true);
    try {
      await api.addDocumentLink(values.name.trim(), values.url.trim(), uploader);
      message.success('外链文档已添加');
      setLinkOpen(false);
      linkForm.resetFields();
      fetchDocs();
    } catch (e: any) { message.error(e.message); }
    finally { setLinkSubmitting(false); }
  };

  const handleDelete = async (id: string) => {
    try { await api.deleteDocument(id); message.success('删除成功'); fetchDocs(); }
    catch (e: any) { message.error(e.message); }
  };

  const copyPlain = async (d: DocItem) => {
    const ok = await copyToClipboard(docUrl(d));
    if (ok) message.success('链接已复制'); else message.warning('复制失败，请手动复制');
  };
  const copyMarkdown = async (d: DocItem) => {
    const url = docUrl(d);
    const isImg = (d.mimetype ?? '').startsWith('image/');
    const md = `${isImg ? '!' : ''}[${d.name}](${url})`;
    const ok = await copyToClipboard(md);
    if (ok) message.success('Markdown 已复制'); else message.warning('复制失败，请手动复制');
  };

  const columns = [
    {
      title: '名称', dataIndex: 'name', ellipsis: true,
      render: (v: string, d: DocItem) => <a onClick={() => window.open(docUrl(d), '_blank')}>{v}</a>,
    },
    {
      title: '类型', dataIndex: 'type', width: 90,
      render: (v: string) => v === 'link'
        ? <Tag color="purple" icon={<LinkOutlined />}>外链</Tag>
        : <Tag color="blue">文件</Tag>,
    },
    { title: '大小', dataIndex: 'size', width: 90, render: (v: number | null, d: DocItem) => d.type === 'link' ? '-' : fmtSize(v) },
    { title: '上传人', dataIndex: 'uploadedBy', width: 100, render: (v: string | null) => v || '-' },
    {
      title: '时间', dataIndex: 'createdAt', width: 150,
      render: (v: string) => <Tooltip title={dayjs(v).format('YYYY-MM-DD HH:mm')}>{dayjs(v).format('MM-DD HH:mm')}</Tooltip>,
      defaultSortOrder: 'descend' as const,
      sorter: (a: DocItem, b: DocItem) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    },
    {
      title: '操作', width: 240, fixed: 'right' as const,
      render: (_: unknown, d: DocItem) => (
        <Space size={8}>
          <a onClick={() => copyPlain(d)}>复制链接</a>
          <a onClick={() => copyMarkdown(d)}>复制Markdown</a>
          <a onClick={() => window.open(docUrl(d), '_blank')}>{d.type === 'link' ? '打开' : '下载'}</a>
          <Popconfirm title={`确认删除「${d.name}」？`} onConfirm={() => handleDelete(d.id)}>
            <a style={{ color: '#ff4d4f' }}>删除</a>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>文档中心</Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetchDocs}>刷新</Button>
          <Button icon={<LinkOutlined />} onClick={() => setLinkOpen(true)}>添加链接</Button>
          <Upload {...uploadProps}>
            <Button icon={<UploadOutlined />} type="primary" loading={uploading}>上传文档</Button>
          </Upload>
        </Space>
      </div>

      <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
        上传文件或添加外链；用「复制链接 / 复制Markdown」把文档地址粘贴到信息广场、动态标签等 Markdown 内容中引用。
      </Text>

      {loading ? <Skeleton active paragraph={{ rows: 6 }} /> : docs.length === 0 ? (
        <Empty description="暂无文档，点击「上传文档」或「添加链接」" />
      ) : (
        <Table rowKey="id" dataSource={docs} columns={columns}
          scroll={{ x: true }}
          pagination={{ pageSize: PAGE_SIZE, showSizeChanger: true, pageSizeOptions: PAGE_SIZE_OPTIONS, showTotal: (t) => `共 ${t} 条` }}
          size="middle" />
      )}

      <Modal title="添加外链文档" open={linkOpen} okText="添加" confirmLoading={linkSubmitting}
        onCancel={() => { setLinkOpen(false); linkForm.resetFields(); }} onOk={() => linkForm.submit()} destroyOnClose>
        <Form form={linkForm} layout="vertical" onFinish={handleAddLink} initialValues={{ name: '', url: '' }}>
          <Form.Item name="name" label="文档名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如：发布流程 SOP" />
          </Form.Item>
          <Form.Item name="url" label="链接地址" rules={[{ required: true, message: '请输入链接', type: 'url', warningOnly: false }]}>
            <Input placeholder="https://..." />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
