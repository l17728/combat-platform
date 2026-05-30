import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Upload, Button, Space, Table, Input, Select, DatePicker, message, Popconfirm,
  Tag, Typography, Empty, Alert, Tooltip, Modal,
} from 'antd';
import {
  InboxOutlined, DeleteOutlined, ReloadOutlined, RobotOutlined,
  CheckSquareOutlined, ClearOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { UploadFile } from 'antd/es/upload';
import dayjs, { type Dayjs } from 'dayjs';
import { api, type WelinkMessage, type WelinkUploadMessage } from '../api.js';

const { Text } = Typography;
const { Dragger } = Upload;

interface Props {
  ticketId: string;
}

interface Stats { total: number; selected: number; deleted: number }

function normalizeMessage(raw: any): WelinkUploadMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const messageId = String(raw.messageId ?? raw.id ?? raw.msgId ?? '').trim();
  const sentAtSrc = raw.sentAt ?? raw.time ?? raw.timestamp ?? raw.sendTime;
  const sentAt = sentAtSrc ? String(sentAtSrc) : '';
  const author = String(raw.author ?? raw.sender ?? raw.from ?? raw.userName ?? '').trim();
  if (!messageId || !sentAt || !author) return null;
  return {
    messageId,
    sentAt,
    author,
    authorId: raw.authorId ?? raw.senderId ?? raw.fromId ?? undefined,
    content: String(raw.content ?? raw.text ?? raw.message ?? ''),
    attachments: Array.isArray(raw.attachments) ? raw.attachments : undefined,
    raw,
  };
}

function parseUploadFile(file: File): Promise<WelinkUploadMessage[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result || '');
        const data = JSON.parse(text);
        const list = Array.isArray(data) ? data : Array.isArray(data?.messages) ? data.messages : null;
        if (!list) return reject(new Error('JSON 必须为消息数组或 { messages: [...] }'));
        const normalized: WelinkUploadMessage[] = [];
        for (const m of list) {
          const n = normalizeMessage(m);
          if (n) normalized.push(n);
        }
        resolve(normalized);
      } catch (e: any) {
        reject(new Error(`解析 JSON 失败: ${e.message || e}`));
      }
    };
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsText(file, 'utf-8');
  });
}

export default function WelinkTab({ ticketId }: Props) {
  const [messages, setMessages] = useState<WelinkMessage[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, selected: 0, deleted: 0 });
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);

  // 筛选状态
  const [authorFilter, setAuthorFilter] = useState<string[]>([]);
  const [timeRange, setTimeRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [keywordInclude, setKeywordInclude] = useState('');
  const [keywordExclude, setKeywordExclude] = useState('');

  const fetchMessages = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const r = await api.listWelinkMessages(ticketId, { limit: 2000 });
      setMessages(r.messages);
      setStats(r.stats);
    } catch (e: any) {
      message.error(`加载消息失败: ${e.message || e}`);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => { void fetchMessages(); }, [fetchMessages]);

  const authorOptions = useMemo(() => {
    const set = new Set<string>();
    for (const m of messages) if (m.author) set.add(m.author);
    return Array.from(set).map((a) => ({ value: a, label: a }));
  }, [messages]);

  const filtered = useMemo(() => {
    const since = timeRange?.[0]?.toISOString();
    const until = timeRange?.[1]?.toISOString();
    const inc = keywordInclude.trim();
    const exc = keywordExclude.trim();
    return messages.filter((m) => {
      if (authorFilter.length && !authorFilter.includes(m.author)) return false;
      if (since && m.sentAt < since) return false;
      if (until && m.sentAt > until) return false;
      if (inc && !m.content.includes(inc)) return false;
      if (exc && m.content.includes(exc)) return false;
      return true;
    });
  }, [messages, authorFilter, timeRange, keywordInclude, keywordExclude]);

  const beforeUpload = useCallback(async (file: File) => {
    setUploading(true);
    try {
      const messagesToUpload = await parseUploadFile(file);
      if (messagesToUpload.length === 0) {
        message.warning('未在文件中发现可识别的消息');
        return Upload.LIST_IGNORE;
      }
      const chunkSize = 500;
      let inserted = 0;
      let updated = 0;
      for (let i = 0; i < messagesToUpload.length; i += chunkSize) {
        const slice = messagesToUpload.slice(i, i + chunkSize);
        const r = await api.uploadWelinkMessages(ticketId, slice);
        inserted += r.inserted;
        updated += r.updated;
      }
      message.success(`上传完成:新增 ${inserted} 条,覆盖 ${updated} 条`);
      await fetchMessages(true);
    } catch (e: any) {
      message.error(`上传失败: ${e.message || e}`);
    } finally {
      setUploading(false);
    }
    return Upload.LIST_IGNORE;
  }, [ticketId, fetchMessages]);

  const handleSelectAllFiltered = () => {
    setSelectedRowKeys(filtered.map((m) => m.id));
  };
  const handleInvertSelection = () => {
    const cur = new Set(selectedRowKeys);
    const next = filtered.filter((m) => !cur.has(m.id)).map((m) => m.id);
    setSelectedRowKeys(next);
  };
  const handleClearSelection = () => setSelectedRowKeys([]);

  const handleBatchDelete = async () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先勾选要删除的消息');
      return;
    }
    try {
      const r = await api.batchDeleteWelinkMessages(ticketId, selectedRowKeys);
      message.success(`已删除 ${r.deleted} 条`);
      setSelectedRowKeys([]);
      await fetchMessages(true);
    } catch (e: any) {
      message.error(`批量删除失败: ${e.message || e}`);
    }
  };

  const handleDeleteOne = async (id: string) => {
    try {
      await api.deleteWelinkMessage(ticketId, id);
      message.success('已删除');
      await fetchMessages(true);
    } catch (e: any) {
      message.error(`删除失败: ${e.message || e}`);
    }
  };

  const handleClearAll = async () => {
    try {
      const r = await api.deleteAllWelinkMessages(ticketId);
      message.success(`已清空 ${r.deleted} 条消息`);
      setSelectedRowKeys([]);
      await fetchMessages(true);
    } catch (e: any) {
      message.error(`清空失败: ${e.message || e}`);
    }
  };

  const handleToggleSelected = async (ids: string[], selected: boolean) => {
    if (ids.length === 0) {
      message.warning('请先勾选消息');
      return;
    }
    try {
      const r = await api.updateWelinkSelection(ticketId, ids, selected);
      message.success(`已${selected ? '纳入' : '排除'} ${r.updated} 条`);
      await fetchMessages(true);
    } catch (e: any) {
      message.error(`更新选中失败: ${e.message || e}`);
    }
  };

  const handleAnalyze = async () => {
    try {
      const r = await api.analyzeWelinkMessages(ticketId);
      Modal.info({
        title: 'AI 分析',
        content: (
          <div>
            <p>已排入分析队列的消息条数:<strong>{r.queued}</strong></p>
            <p style={{ color: '#666' }}>{r.message}</p>
          </div>
        ),
      });
    } catch (e: any) {
      message.error(`触发 AI 分析失败: ${e.message || e}`);
    }
  };

  const columns: ColumnsType<WelinkMessage> = [
    {
      title: '时间', dataIndex: 'sentAt', key: 'sentAt', width: 170,
      render: (v: string) => (
        <Tooltip title={v}>
          <Text style={{ fontSize: 12 }}>{dayjs(v).isValid() ? dayjs(v).format('MM-DD HH:mm:ss') : v}</Text>
        </Tooltip>
      ),
      sorter: (a, b) => a.sentAt.localeCompare(b.sentAt),
      defaultSortOrder: 'ascend',
    },
    {
      title: '发言人', dataIndex: 'author', key: 'author', width: 120,
      render: (v: string) => <Tag color="blue">{v}</Tag>,
    },
    {
      title: '内容', dataIndex: 'content', key: 'content', ellipsis: true,
      render: (v: string) => <Text style={{ whiteSpace: 'pre-wrap' }}>{v}</Text>,
    },
    {
      title: '纳入分析', dataIndex: 'selected', key: 'selected', width: 100,
      render: (v: boolean, row) => (
        v ? <Tag color="green">已纳入</Tag>
          : <a onClick={() => handleToggleSelected([row.id], true)}>排除中</a>
      ),
    },
    {
      title: '操作', key: 'actions', width: 80, fixed: 'right',
      render: (_, row) => (
        <Popconfirm title="确认删除该条消息？" onConfirm={() => handleDeleteOne(row.id)}>
          <a style={{ color: '#ff4d4f' }}>删除</a>
        </Popconfirm>
      ),
    },
  ];

  return (
    <div style={{ padding: '16px 0' }}>
      <Alert
        message="Welink 群消息"
        description="上传由 Welink 下载工具导出的群消息 JSON;支持按时段/发言人/关键词筛选;选中的子集会进入下一阶段 AI 抽取分析。"
        type="info" showIcon style={{ marginBottom: 16 }}
      />

      <Dragger
        accept=".json,application/json"
        multiple={false}
        showUploadList={false}
        beforeUpload={beforeUpload as any}
        disabled={uploading}
        style={{ marginBottom: 16 }}
      >
        <p className="ant-upload-drag-icon"><InboxOutlined /></p>
        <p className="ant-upload-text">{uploading ? '上传中…' : '点击或拖拽 Welink 群消息 JSON 到此处'}</p>
        <p className="ant-upload-hint" style={{ fontSize: 12 }}>
          支持顶层数组或 {`{ messages: [...] }`};按 (messageId) 覆盖式去重
        </p>
      </Dragger>

      <Space wrap style={{ marginBottom: 12 }}>
        <Text strong>共 {stats.total} 条</Text>
        <Text type="secondary">/ 纳入分析 {stats.selected} 条 / 已软删 {stats.deleted} 条</Text>
        <Text type="secondary">/ 当前显示 {filtered.length} 条</Text>
        <Button icon={<ReloadOutlined />} size="small" onClick={() => fetchMessages()}>刷新</Button>
      </Space>

      <Space wrap style={{ marginBottom: 12 }}>
        <Select
          mode="multiple"
          allowClear
          showSearch
          placeholder="发言人筛选"
          style={{ minWidth: 200, maxWidth: 360 }}
          value={authorFilter}
          onChange={setAuthorFilter}
          options={authorOptions}
        />
        <DatePicker.RangePicker
          showTime
          value={timeRange as any}
          onChange={(v) => setTimeRange(v as any)}
          placeholder={['起始时间', '截止时间']}
        />
        <Input
          allowClear
          placeholder="包含关键词"
          style={{ width: 180 }}
          value={keywordInclude}
          onChange={(e) => setKeywordInclude(e.target.value)}
        />
        <Input
          allowClear
          placeholder="排除关键词"
          style={{ width: 180 }}
          value={keywordExclude}
          onChange={(e) => setKeywordExclude(e.target.value)}
        />
      </Space>

      <Space wrap style={{ marginBottom: 12 }}>
        <Button icon={<CheckSquareOutlined />} onClick={handleSelectAllFiltered}>全选当前</Button>
        <Button onClick={handleInvertSelection}>反选当前</Button>
        <Button onClick={handleClearSelection}>清空勾选</Button>
        <Button onClick={() => handleToggleSelected(selectedRowKeys, true)} disabled={!selectedRowKeys.length}>
          纳入分析 ({selectedRowKeys.length})
        </Button>
        <Button onClick={() => handleToggleSelected(selectedRowKeys, false)} disabled={!selectedRowKeys.length}>
          排除分析 ({selectedRowKeys.length})
        </Button>
        <Popconfirm
          title="确认软删勾选的消息？"
          onConfirm={handleBatchDelete}
          disabled={!selectedRowKeys.length}
        >
          <Button icon={<DeleteOutlined />} danger disabled={!selectedRowKeys.length}>
            批量删除 ({selectedRowKeys.length})
          </Button>
        </Popconfirm>
      </Space>

      <div style={{ marginBottom: 12 }}>
        <Space wrap>
          <Button type="primary" icon={<RobotOutlined />} onClick={handleAnalyze}>
            让 AI 分析(已选 {stats.selected} 条)
          </Button>
          <Popconfirm
            title="确认物理清空该攻关单全部 Welink 消息？此操作不可恢复"
            okText="清空"
            okType="danger"
            onConfirm={handleClearAll}
            disabled={stats.total + stats.deleted === 0}
          >
            <Button icon={<ClearOutlined />} danger disabled={stats.total + stats.deleted === 0}>
              清空全部消息
            </Button>
          </Popconfirm>
        </Space>
      </div>

      <Table<WelinkMessage>
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={filtered}
        columns={columns}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as string[]),
        }}
        pagination={{ pageSize: 50, showSizeChanger: true, pageSizeOptions: [20, 50, 100, 200], showTotal: (t) => `共 ${t} 条` }}
        scroll={{ x: true }}
        locale={{ emptyText: <Empty description="暂无 Welink 消息,先上传一份" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
      />
    </div>
  );
}

// 兼容 antd Upload 类型签名
export type _WelinkUnused = UploadFile;
