import { useState, useEffect, useCallback } from 'react';
import {
  Typography, Table, Tag, Space, Select, Button, Drawer, Form, Input, message,
  Popconfirm, Empty, Tooltip, Image, Alert, Descriptions,
} from 'antd';
import { BugOutlined, CameraOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { api } from '../api.js';
import { BUG_SEVERITY_COLOR, BUG_STATUS_COLOR, PAGE_SIZE, PAGE_SIZE_OPTIONS, DATE_FORMAT } from '../constants.js';
import { getCapturedLogs, clearCapturedLogs } from '../utils/console-capture.js';
import HelpButton from '../components/HelpButton.js';
import HELP from '../help-content.js';
import dayjs from 'dayjs';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

export default function BugReport() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string | undefined>('待处理');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [consoleLogs, setConsoleLogs] = useState<string>('');
  const [form] = Form.useForm();

  const fetchData = useCallback(async (silent?: boolean) => {
    if (!silent) setLoading(true);
    try {
      const list = await api.listBugReports(statusFilter);
      setData(list);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleScreenshot = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      message.warning('截图不能超过 5MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setScreenshot(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (values: any) => {
    const logs = getCapturedLogs();
    try {
      await api.createBugReport({
        title: values.title,
        description: values.description ?? '',
        severity: values.severity ?? '一般',
        pageUrl: values.pageUrl ?? window.location.href,
        reporter: values.reporter ?? '',
        screenshot: screenshot ?? undefined,
        consoleLogs: logs || values.manualLogs || undefined,
        userAgent: navigator.userAgent,
      });
      message.success('问题已提交');
      setDrawerOpen(false);
      setScreenshot(null);
      setConsoleLogs('');
      form.resetFields();
      fetchData();
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const handleUpdate = async (id: string, status: string, resolution?: string) => {
    try {
      await api.updateBugReport(id, { status, resolution, resolvedBy: 'ui' });
      message.success('状态已更新');
      fetchData(true);
      if (detail?.id === id) {
        setDetail(await api.getBugReport(id));
      }
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteBugReport(id);
      message.success('已删除');
      fetchData();
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const capturePage = async () => {
    try {
      const canvas = await (window as any).__html2canvas?.(document.body);
      if (canvas) {
        setScreenshot(canvas.toDataURL('image/png'));
        message.success('页面截图完成');
      } else {
        message.info('请使用截图工具或点击下方上传截图');
      }
    } catch {
      message.info('请使用截图工具或点击下方上传截图');
    }
  };

  const loadConsoleLogs = () => {
    const logs = getCapturedLogs();
    setConsoleLogs(logs);
    if (!logs) message.info('暂无捕获的 console 日志');
  };

  const columns = [
    {
      title: '标题', dataIndex: 'title', key: 'title',
      render: (text: string, record: any) => (
        <a onClick={() => { setDetail(record); setDetailOpen(true); }}>{text}</a>
      ),
    },
    {
      title: '严重程度', dataIndex: 'severity', key: 'severity', width: 100,
      render: (s: string) => <Tag color={BUG_SEVERITY_COLOR[s]}>{s}</Tag>,
    },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 90,
      render: (s: string) => <Tag color={BUG_STATUS_COLOR[s]}>{s}</Tag>,
    },
    {
      title: '报告人', dataIndex: 'reporter', key: 'reporter', width: 100,
    },
    {
      title: '页面', dataIndex: 'pageUrl', key: 'pageUrl', width: 160, ellipsis: true,
      render: (u: string) => <Tooltip title={u}><Text style={{ fontSize: 12 }}>{u}</Text></Tooltip>,
    },
    {
      title: '时间', dataIndex: 'createdAt', key: 'createdAt', width: 140,
      sorter: (a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      defaultSortOrder: 'descend' as const,
      render: (t: string) => (
        <Tooltip title={dayjs(t).format(DATE_FORMAT)}>
          <Text style={{ fontSize: 12 }}>{dayjs(t).fromNow()}</Text>
        </Tooltip>
      ),
    },
    {
      title: '操作', key: 'actions', width: 200, fixed: 'right' as const,
      render: (_: unknown, record: any) => (
        <Space>
          <a onClick={() => { setDetail(record); setDetailOpen(true); }}>详情</a>
          {record.status === '待处理' && (
            <a onClick={() => handleUpdate(record.id, '处理中')}>开始处理</a>
          )}
          {record.status === '处理中' && (
            <a style={{ color: '#52c41a' }} onClick={() => handleUpdate(record.id, '已解决')}>已解决</a>
          )}
          {(record.status === '已解决') && (
            <a onClick={() => handleUpdate(record.id, '已关闭')}>关闭</a>
          )}
          <Popconfirm title="确认删除？" onConfirm={() => handleDelete(record.id)}>
            <a style={{ color: '#ff4d4f' }}><DeleteOutlined /> 删除</a>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Title level={4} style={{ margin: 0 }}>问题反馈</Title>
          <HelpButton title={HELP.bugReport.title} content={HELP.bugReport.content} />
        </div>
        <Space>
          <Select
            allowClear
            placeholder="状态筛选"
            style={{ width: 120 }}
            value={statusFilter}
            onChange={(v) => setStatusFilter(v)}
            options={[
              { value: '待处理', label: '待处理' },
              { value: '处理中', label: '处理中' },
              { value: '已解决', label: '已解决' },
              { value: '已关闭', label: '已关闭' },
            ]}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setDrawerOpen(true)}>
            提交问题
          </Button>
        </Space>
      </div>

      <Table
        rowKey="id"
        dataSource={data}
        columns={columns}
        loading={loading}
        size="middle"
        scroll={{ x: 'max-content' }}
        pagination={{
          pageSize: PAGE_SIZE,
          showSizeChanger: true,
          pageSizeOptions: PAGE_SIZE_OPTIONS,
          showTotal: (t) => `共 ${t} 条`,
        }}
        locale={{ emptyText: <Empty description="暂无问题反馈" /> }}
      />

      <Drawer
        title="提交问题反馈"
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setScreenshot(null); setConsoleLogs(''); form.resetFields(); }}
        width={480}
        destroyOnClose
        maskClosable={false}
        extra={<Button type="primary" onClick={() => form.submit()}>提交</Button>}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="title" label="问题标题" rules={[{ required: true, message: '请输入问题标题' }]}>
            <Input placeholder="简要描述发现的问题" />
          </Form.Item>
          <Form.Item name="severity" label="严重程度" initialValue="一般">
            <Select options={[
              { value: '严重', label: '严重' },
              { value: '较高', label: '较高' },
              { value: '一般', label: '一般' },
              { value: '建议', label: '建议' },
            ]} />
          </Form.Item>
          <Form.Item name="description" label="问题描述">
            <TextArea rows={4} placeholder="详细描述问题现象、复现步骤、预期行为等" />
          </Form.Item>
          <Form.Item name="reporter" label="报告人">
            <Input placeholder="您的姓名（可选）" />
          </Form.Item>
          <Form.Item name="pageUrl" label="问题页面" initialValue={typeof window !== 'undefined' ? window.location.href : ''}>
            <Input placeholder="问题发生时的页面地址" />
          </Form.Item>

          <div style={{ marginBottom: 16 }}>
            <div style={{ marginBottom: 8, fontWeight: 500 }}>
              <CameraOutlined style={{ marginRight: 4 }} /> 截图
            </div>
            {screenshot && (
              <div style={{ marginBottom: 8 }}>
                <Image src={screenshot} alt="screenshot" style={{ maxHeight: 200, border: '1px solid #d9d9d9', borderRadius: 4 }} />
                <div style={{ marginTop: 4 }}>
                  <Button size="small" danger onClick={() => setScreenshot(null)}>移除截图</Button>
                </div>
              </div>
            )}
            <input type="file" accept="image/*" onChange={handleScreenshot} style={{ fontSize: 13 }} />
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ marginBottom: 8, fontWeight: 500 }}>
              <BugOutlined style={{ marginRight: 4 }} /> Console 日志
            </div>
            <Alert
              type="info"
              message="系统已自动捕获浏览器 console 日志（log/warn/error/info/debug），提交时将一并上传。"
              style={{ marginBottom: 8, fontSize: 12 }}
            />
            <Button size="small" onClick={loadConsoleLogs} style={{ marginBottom: 8 }}>
              预览已捕获的日志
            </Button>
            {consoleLogs && (
              <div style={{
                maxHeight: 200, overflow: 'auto', background: '#1e1e1e', color: '#d4d4d4',
                padding: 8, borderRadius: 4, fontSize: 11, fontFamily: 'monospace',
                whiteSpace: 'pre-wrap', marginBottom: 8,
              }}>
                {consoleLogs}
              </div>
            )}
            <Form.Item name="manualLogs" style={{ marginBottom: 0 }}>
              <TextArea rows={3} placeholder="或手动粘贴 console 日志（可选）" style={{ fontFamily: 'monospace', fontSize: 12 }} />
            </Form.Item>
          </div>
        </Form>
      </Drawer>

      <Drawer
        title="问题详情"
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        width={560}
        destroyOnClose
        maskClosable={false}
      >
        {detail && (
          <div>
            <Descriptions bordered size="small" column={1}>
              <Descriptions.Item label="标题">{detail.title}</Descriptions.Item>
              <Descriptions.Item label="严重程度">
                <Tag color={BUG_SEVERITY_COLOR[detail.severity]}>{detail.severity}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={BUG_STATUS_COLOR[detail.status]}>{detail.status}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="报告人">{detail.reporter || '—'}</Descriptions.Item>
              <Descriptions.Item label="页面">{detail.pageUrl || '—'}</Descriptions.Item>
              <Descriptions.Item label="问题描述">
                <Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{detail.description || '—'}</Paragraph>
              </Descriptions.Item>
              {detail.resolution && (
                <Descriptions.Item label="解决方案">
                  <Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{detail.resolution}</Paragraph>
                </Descriptions.Item>
              )}
              {detail.resolvedBy && (
                <Descriptions.Item label="处理人">{detail.resolvedBy}</Descriptions.Item>
              )}
              {detail.resolvedAt && (
                <Descriptions.Item label="处理时间">{dayjs(detail.resolvedAt).format(DATE_FORMAT)}</Descriptions.Item>
              )}
              <Descriptions.Item label="提交时间">{dayjs(detail.createdAt).format(DATE_FORMAT)}</Descriptions.Item>
              {detail.userAgent && (
                <Descriptions.Item label="浏览器">
                  <Text style={{ fontSize: 11, wordBreak: 'break-all' }}>{detail.userAgent}</Text>
                </Descriptions.Item>
              )}
            </Descriptions>

            {detail.screenshot && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontWeight: 500, marginBottom: 8 }}>截图</div>
                <Image src={detail.screenshot} alt="bug screenshot" style={{ maxWidth: '100%', border: '1px solid #d9d9d9', borderRadius: 4 }} />
              </div>
            )}

            {detail.consoleLogs && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontWeight: 500, marginBottom: 8 }}>Console 日志</div>
                <div style={{
                  maxHeight: 300, overflow: 'auto', background: '#1e1e1e', color: '#d4d4d4',
                  padding: 8, borderRadius: 4, fontSize: 11, fontFamily: 'monospace',
                  whiteSpace: 'pre-wrap',
                }}>
                  {detail.consoleLogs}
                </div>
              </div>
            )}

            <div style={{ marginTop: 16, borderTop: '1px solid #f0f0f0', paddingTop: 16 }}>
              <Space>
                {detail.status === '待处理' && (
                  <Button type="primary" onClick={() => { handleUpdate(detail.id, '处理中'); setDetailOpen(false); }}>
                    开始处理
                  </Button>
                )}
                {detail.status === '处理中' && (
                  <Button type="primary" onClick={() => { handleUpdate(detail.id, '已解决'); setDetailOpen(false); }}>
                    标记已解决
                  </Button>
                )}
                {detail.status === '已解决' && (
                  <Button onClick={() => { handleUpdate(detail.id, '已关闭'); setDetailOpen(false); }}>
                    关闭问题
                  </Button>
                )}
                <Popconfirm title="确认删除？" onConfirm={() => { handleDelete(detail.id); setDetailOpen(false); }}>
                  <Button danger>删除</Button>
                </Popconfirm>
              </Space>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
