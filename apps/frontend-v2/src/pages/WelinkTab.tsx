import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Upload, Button, Space, Table, Input, Select, DatePicker, message, Popconfirm,
  Tag, Typography, Empty, Alert, Tooltip, Segmented,
} from 'antd';
import {
  InboxOutlined, DeleteOutlined, ReloadOutlined, RobotOutlined,
  CheckSquareOutlined, ClearOutlined, UnorderedListOutlined, MessageOutlined,
  BulbOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { UploadFile } from 'antd/es/upload';
import dayjs, { type Dayjs } from 'dayjs';
import { api, type WelinkMessage } from '../api.js';
import WelinkChatView from './WelinkChatView.js';
import WelinkExtractionsDrawer from './WelinkExtractionsDrawer.js';
import HermesChat from '../components/HermesChat.js';

const { Text } = Typography;
const { Dragger } = Upload;

interface Props {
  ticketId: string;
  /** 场景 3:从 Hermes welink citation 跳转过来时携带的目标消息 id;
   *  非空时强制 viewMode='chat' 并把 id 透传给 WelinkChatView 做滚动+高亮。 */
  highlightMessageId?: string;
}

interface Stats { total: number; selected: number; deleted: number }

function normalizeMessage(raw: any): any {
  if (!raw || typeof raw !== 'object') return null;
  const messageId = String(raw.messageId ?? raw.id ?? raw.msgId ?? '').trim();
  const sentAtSrc = raw.sentAt ?? raw.time ?? raw.timestamp ?? raw.sendTime ?? raw.serverSendTime;
  const sentAt = sentAtSrc ?? '';
  const author = String(raw.author ?? raw.sender ?? raw.from ?? raw.userName ?? '').trim();
  if (!messageId || sentAt === '' || sentAt == null || !author) return null;
  // 透传原始字段(serverSendTime / contentType / images / 对象 content),后端解析
  return {
    ...raw,
    messageId,
    sentAt: typeof sentAt === 'number' ? sentAt : String(sentAt),
    author,
  };
}

function parseUploadFile(file: File): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result || '');
        const data = JSON.parse(text);
        const list = Array.isArray(data) ? data : Array.isArray(data?.messages) ? data.messages : null;
        if (!list) return reject(new Error('JSON 必须为消息数组或 { messages: [...] }'));
        const normalized: any[] = [];
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

export default function WelinkTab({ ticketId, highlightMessageId }: Props) {
  const [messages, setMessages] = useState<WelinkMessage[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, selected: 0, deleted: 0 });
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [extractionsOpen, setExtractionsOpen] = useState(false);
  const [extractionCount, setExtractionCount] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'chat'>(() => {
    if (typeof window === 'undefined') return 'list';
    const v = window.localStorage.getItem('combat-welink-view');
    return v === 'chat' ? 'chat' : 'list';
  });

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

  const fetchExtractionCount = useCallback(async () => {
    try {
      const r = await api.listWelinkExtractions(ticketId);
      setExtractionCount(r.items.length);
    } catch {
      // 不打扰用户:统计失败保持 0
    }
  }, [ticketId]);
  useEffect(() => { void fetchExtractionCount(); }, [fetchExtractionCount]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('combat-welink-view', viewMode);
    }
  }, [viewMode]);

  // 场景 3:有外部 highlightMessageId 时强制聊天视图,方便高亮锚点
  useEffect(() => {
    if (highlightMessageId) setViewMode('chat');
  }, [highlightMessageId]);

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
    setAnalyzing(true);
    try {
      const r = await api.analyzeWelinkMessages(ticketId);
      if (r.queued === 0) {
        message.warning('没有已选中的消息可供分析,请先勾选要分析的消息');
      } else if (r.extracted === 0) {
        message.info('未抽取出新信息');
      } else {
        message.success(`AI 抽取完成:从 ${r.queued} 条消息抽出 ${r.extracted} 项 (来源:${r.source})`);
      }
      await fetchExtractionCount();
      // 抽完直接打开 Drawer 让用户查看
      if (r.extracted > 0) setExtractionsOpen(true);
    } catch (e: any) {
      message.error(`触发 AI 分析失败: ${e.message || e}`);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleMembersChanged = useCallback(() => {
    // 抽取项触发的"加成员"会改变 gap,这里轻量刷新 count + ticket 数据
    void fetchExtractionCount();
  }, [fetchExtractionCount]);

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
        <Segmented
          value={viewMode}
          onChange={(v) => setViewMode(v as 'list' | 'chat')}
          options={[
            { label: <span><UnorderedListOutlined /> 列表视图</span>, value: 'list' },
            { label: <span><MessageOutlined /> 聊天视图</span>, value: 'chat' },
          ]}
        />
        <Button
          icon={<BulbOutlined />}
          size="small"
          onClick={() => setExtractionsOpen(true)}
          data-testid="welink-open-extractions"
        >
          AI 抽取 ({extractionCount})
        </Button>
        {viewMode === 'chat' && (
          <Button
            type="primary"
            size="small"
            icon={<RobotOutlined />}
            onClick={handleAnalyze}
            loading={analyzing}
            data-testid="welink-analyze-btn-chat"
          >
            让 AI 分析(已选 {stats.selected} 条)
          </Button>
        )}
      </Space>

      {viewMode === 'list' ? (
        <>
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
              <Button
                type="primary"
                icon={<RobotOutlined />}
                onClick={handleAnalyze}
                loading={analyzing}
                data-testid="welink-analyze-btn"
              >
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
        </>
      ) : (
        <WelinkChatView
          ticketId={ticketId}
          messages={messages}
          reload={() => fetchMessages(true)}
          loading={loading}
          highlightMessageId={highlightMessageId}
        />
      )}

      <WelinkExtractionsDrawer
        open={extractionsOpen}
        ticketId={ticketId}
        onClose={() => { setExtractionsOpen(false); void fetchExtractionCount(); }}
        onMembersChanged={handleMembersChanged}
      />

      <HermesChat
        title="AI 助手 · 群消息补齐"
        placeholder="例:把群里活跃的人都加进来 / 张三李四加进来 / 谁先提的问题"
        context={`当前攻关单 id=${ticketId};用户正在 Welink 群消息场景。若用户问及成员/补齐/活跃,主动调 hermes_gapAnalysis(ticketId)。`}
        greeting={`你好,我可以帮你分析群里发言、对照攻关单成员、做成员补齐。例如:\n- 「群里活跃但没在成员里的有谁?」\n- 「把 X、Y 加进来」\n- 「除了 Z 其它都加进来」\n\n当前攻关单 id:${ticketId.slice(0, 8)}…`}
        bottom={88}
        testId="welink-hermes-trigger"
      />
    </div>
  );
}

// 兼容 antd Upload 类型签名
export type _WelinkUnused = UploadFile;
