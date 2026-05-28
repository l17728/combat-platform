import { useEffect, useState, useCallback } from 'react';
import {
  Row, Col, Card, Tag, Typography, Space, Select, Input, Button,
  Drawer, Form, message, Popconfirm, Empty, Skeleton, Avatar, Tooltip,
} from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../api.js';
import { INFO_IMPORTANCE_COLOR, INFO_CATEGORY_COLOR } from '../constants.js';
import { useSettings } from '../hooks/useSettings.js';
import { useAuth } from '../hooks/useAuth.js';
import type { GraphNode } from '@combat/shared';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const { Title, Text, Paragraph } = Typography;

interface CardData {
  id: string;
  title: string;
  summary: string;
  content: string;
  importance: string;
  category: string;
  author: string;
  createdAt: string;
}

function toCardData(node: GraphNode): CardData {
  const p = node.properties;
  return {
    id: node.id,
    title: (p['标题'] as string) || '',
    summary: (p['摘要'] as string) || '',
    content: (p['内容'] as string) || '',
    importance: (p['重要程度'] as string) || '普通',
    category: (p['信息分类'] as string) || '其他',
    author: (p['发布人'] as string) || '未知',
    createdAt: node.createdAt,
  };
}

export default function InfoSquare() {
  const { getValues } = useSettings();
  const { user, isAdmin } = useAuth();
  const categories = getValues('信息分类');
  const importanceLevels = getValues('重要程度');

  const [cards, setCards] = useState<CardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>();
  const [importanceFilter, setImportanceFilter] = useState<string | undefined>();
  const [searchText, setSearchText] = useState('');

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailCard, setDetailCard] = useState<CardData | null>(null);
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [previewContent, setPreviewContent] = useState('');

  const fetchData = useCallback(async (silent?: boolean) => {
    if (!silent) setLoading(true);
    try {
      const filter: Record<string, string> = {};
      if (categoryFilter) filter['信息分类'] = categoryFilter;
      if (importanceFilter) filter['重要程度'] = importanceFilter;
      const list = await api.listNodes('infoCard', filter);
      const cardData = list.map(toCardData);
      cardData.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setCards(cardData);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [categoryFilter, importanceFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filteredCards = cards.filter(c => {
    if (!searchText) return true;
    const q = searchText.toLowerCase();
    return c.title.toLowerCase().includes(q) || c.content.toLowerCase().includes(q);
  });

  const handleCreate = async (values: any) => {
    setSubmitting(true);
    try {
      await api.createNode('infoCard', {
        '标题': values.title,
        '摘要': values.summary || '',
        '内容': values.content || '',
        '重要程度': values.importance,
        '信息分类': values.category,
        '发布人': user?.displayName || user?.username || '未知',
      });
      message.success('发布成功');
      setDrawerOpen(false);
      form.resetFields();
      setPreviewContent('');
      fetchData(true);
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
      setDetailOpen(false);
      setDetailCard(null);
      fetchData(true);
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const categoryOptions = categories.length > 0
    ? categories.map(v => ({ value: v, label: v }))
    : ['通知', '公告', '经验', '预警', '其他'].map(v => ({ value: v, label: v }));

  const importanceOptions = importanceLevels.length > 0
    ? importanceLevels.map(v => ({ value: v, label: v }))
    : ['重要', '一般', '普通'].map(v => ({ value: v, label: v }));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>信息广场</Title>
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Select
            allowClear
            placeholder="信息分类"
            style={{ width: 130 }}
            options={categoryOptions}
            value={categoryFilter}
            onChange={setCategoryFilter}
          />
          <Select
            allowClear
            placeholder="重要程度"
            style={{ width: 130 }}
            options={importanceOptions}
            value={importanceFilter}
            onChange={setImportanceFilter}
          />
          <Input.Search
            placeholder="搜索标题/内容"
            style={{ width: 220 }}
            allowClear
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setDrawerOpen(true)}>
            发布信息
          </Button>
        </div>
      </div>

      {loading ? (
        <Row gutter={[16, 16]}>
          {[1, 2, 3, 4].map(i => (
            <Col key={i} xs={24} sm={12} md={8} lg={6}>
              <Card><Skeleton active paragraph={{ rows: 4 }} /></Card>
            </Col>
          ))}
        </Row>
      ) : filteredCards.length === 0 ? (
        <Empty description="暂无信息，点击右上角发布" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <Row gutter={[16, 16]}>
          {filteredCards.map(card => {
            const borderColor = INFO_CATEGORY_COLOR[card.category] ?? '#1677ff';
            const colorMap: Record<string, string> = {
              'red': '#ff4d4f', 'orange': '#fa8c16', 'blue': '#1677ff',
              'purple': '#722ed1', 'cyan': '#13c2c2', 'default': '#8c8c8c',
              'geekblue': '#2f54eb',
            };
            const borderHex = colorMap[borderColor] ?? '#1677ff';
            return (
              <Col key={card.id} xs={24} sm={12} md={8} lg={6}>
                <Card
                  hoverable
                  style={{ borderRadius: 8, borderLeft: `4px solid ${borderHex}`, height: '100%', cursor: 'pointer' }}
                  onClick={() => { setDetailCard(card); setDetailOpen(true); }}
                  bodyStyle={{ display: 'flex', flexDirection: 'column', height: '100%' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <Space size={4}>
                      <Tag color={INFO_IMPORTANCE_COLOR[card.importance] ?? 'blue'}>{card.importance}</Tag>
                      <Tag color={INFO_CATEGORY_COLOR[card.category] ?? 'default'}>{card.category}</Tag>
                    </Space>
                  </div>

                  <Text strong ellipsis style={{ fontSize: 15, marginBottom: 8, display: 'block' }}>
                    {card.title}
                  </Text>

                  <Paragraph
                    type="secondary"
                    ellipsis={{ rows: 3, expandable: false }}
                    style={{ marginBottom: 12, minHeight: 60, flex: 1 }}
                  >
                    {card.summary || card.content}
                  </Paragraph>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 'auto' }}>
                    <Avatar size={20} style={{ backgroundColor: borderHex, flexShrink: 0 }}>
                      {card.author[0] || '?'}
                    </Avatar>
                    <Text type="secondary" ellipsis style={{ fontSize: 12 }}>
                      {card.author}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
                      · <Tooltip title={dayjs(card.createdAt).format('YYYY-MM-DD HH:mm:ss')}>
                        {dayjs(card.createdAt).fromNow()}
                      </Tooltip>
                    </Text>
                  </div>
                </Card>
              </Col>
            );
          })}
        </Row>
      )}

      <Drawer
        title="发布信息"
        width={560}
        open={drawerOpen}
        destroyOnClose
        maskClosable={false}
        onClose={() => { setDrawerOpen(false); form.resetFields(); setPreviewContent(''); }}
        extra={
          <Space>
            <Button onClick={() => { setDrawerOpen(false); form.resetFields(); setPreviewContent(''); }}>取消</Button>
            <Button type="primary" loading={submitting} onClick={() => form.submit()}>发布</Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input placeholder="请输入信息标题" maxLength={100} showCount />
          </Form.Item>

          <Form.Item name="importance" label="重要程度" rules={[{ required: true, message: '请选择' }]}>
            <Select placeholder="选择程度" options={importanceOptions} />
          </Form.Item>
          <Form.Item name="category" label="信息分类" rules={[{ required: true, message: '请选择' }]}>
            <Select placeholder="选择分类" options={categoryOptions} />
          </Form.Item>

          <Form.Item name="summary" label="摘要">
            <Input.TextArea rows={2} placeholder="简短描述（可选，不填则自动截取正文）" maxLength={200} showCount />
          </Form.Item>

          <Form.Item name="content" label="正文内容（支持 Markdown）">
            <Input.TextArea
              rows={8}
              placeholder="支持 Markdown 语法，如：## 标题、**加粗**、- 列表"
              style={{ fontFamily: 'monospace' }}
              onChange={e => setPreviewContent(e.target.value)}
            />
          </Form.Item>

          {previewContent && (
            <Card size="small" title="预览" style={{ marginBottom: 16 }}>
              <div style={{ maxHeight: 200, overflow: 'auto' }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{previewContent}</ReactMarkdown>
              </div>
            </Card>
          )}
        </Form>
      </Drawer>

      <Drawer
        title={null}
        width={640}
        open={detailOpen}
        destroyOnClose
        onClose={() => { setDetailOpen(false); setDetailCard(null); }}
        extra={isAdmin && detailCard ? (
          <Popconfirm title="确认删除此信息？" onConfirm={() => handleDelete(detailCard.id)}>
            <Button danger>删除</Button>
          </Popconfirm>
        ) : undefined}
      >
        {detailCard && (
          <div>
            <Title level={4} style={{ marginTop: 0, marginBottom: 8 }}>{detailCard.title}</Title>
            <Space style={{ marginBottom: 8 }}>
              <Tag color={INFO_IMPORTANCE_COLOR[detailCard.importance] ?? 'blue'}>{detailCard.importance}</Tag>
              <Tag color={INFO_CATEGORY_COLOR[detailCard.category] ?? 'default'}>{detailCard.category}</Tag>
            </Space>
            <div style={{ marginBottom: 16 }}>
              <Text type="secondary">
                <Avatar size={20} style={{ marginRight: 4 }}>{detailCard.author[0]}</Avatar>
                {detailCard.author} · {dayjs(detailCard.createdAt).format('YYYY-MM-DD HH:mm:ss')}
              </Text>
            </div>

            <div className="markdown-body" style={{ padding: 16, background: '#fafafa', borderRadius: 8, minHeight: 100 }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{detailCard.content || detailCard.summary}</ReactMarkdown>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
