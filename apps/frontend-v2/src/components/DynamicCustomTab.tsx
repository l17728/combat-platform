import { useState, useCallback, useRef, useEffect } from 'react';
import { Input, Button, Space, message, Divider, Card } from 'antd';
import { DeleteOutlined, RobotOutlined, SendOutlined, SearchOutlined, EditOutlined, UpOutlined } from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { api, type TicketTab } from '../api.js';

const { TextArea } = Input;

function highlightMd(text: string, keyword: string): string {
  if (!keyword) return text;
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`(${escaped})`, 'gi'),
    '<mark style="background:#ffe58f;padding:0 2px;border-radius:2px">$1</mark>');
}

interface ContentBlock {
  type: 'markdown' | 'faq-card';
  content: string;
  question?: string;
  citations?: { nodeId: string; nodeType: string; summary: string; link: string }[];
  id?: string;
}

function parseContent(raw: string): ContentBlock[] {
  if (!raw) return [{ type: 'markdown', content: '' }];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return [{ type: 'markdown', content: raw }];
  } catch {
    return [{ type: 'markdown', content: raw }];
  }
}

function serializeContent(blocks: ContentBlock[]): string {
  return JSON.stringify(blocks);
}

interface Props {
  ticketId: string;
  tab: TicketTab;
  onDeleted: (tabId: string) => void;
  onUpdate: (tab: TicketTab) => void;
}

export default function DynamicCustomTab({ ticketId, tab, onDeleted, onUpdate }: Props) {
  const [blocks, setBlocks] = useState<ContentBlock[]>(() => parseContent(tab.content));
  const [chatOpen, setChatOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setBlocks(parseContent(tab.content));
  }, [tab.content]);

  const saveContent = useCallback((newBlocks: ContentBlock[]) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        const updated = await api.updateTicketTab(ticketId, tab.id, {
          content: serializeContent(newBlocks),
        });
        onUpdate(updated);
      } catch (e: any) {
        message.error('自动保存失败: ' + e.message);
      }
    }, 2000);
  }, [ticketId, tab.id, onUpdate]);

  const updateMdBlock = (index: number, content: string) => {
    const newBlocks = [...blocks];
    newBlocks[index] = { ...newBlocks[index], content };
    setBlocks(newBlocks);
    saveContent(newBlocks);
  };

  const removeFaqCard = (index: number) => {
    const newBlocks = blocks.filter((_, i) => i !== index);
    setBlocks(newBlocks);
    saveContent(newBlocks);
    message.success('已删除');
  };

  const handleAsk = async () => {
    if (!question.trim()) return;
    setChatLoading(true);
    try {
      const result = await api.hermesAsk(question, `当前攻关单 id=${ticketId}(「本组/本单/这个攻关」均指此单)`);
      const faqCard: ContentBlock = {
        type: 'faq-card',
        content: result.answer,
        question: question,
        citations: result.citations,
        id: `faq-${Date.now()}`,
      };
      const newBlocks = [...blocks, faqCard];
      setBlocks(newBlocks);
      saveContent(newBlocks);
      setQuestion('');
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <div style={{ padding: '16px 0', position: 'relative' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => setEditorOpen(!editorOpen)}>
            {editorOpen ? '收起编辑' : '展开编辑'}
          </Button>
          <Button size="small" icon={<RobotOutlined />} onClick={() => setChatOpen(!chatOpen)}>
            {chatOpen ? '收起AI助手' : 'AI助手'}
          </Button>
        </Space>
      </div>

      <div>
        {blocks.map((block, idx) => {
          if (block.type === 'markdown') {
            const hasContent = block.content.trim().length > 0;
            const previewMd = searchKeyword ? highlightMd(block.content, searchKeyword) : block.content;
            return (
              <div key={`md-${idx}`} style={{ marginBottom: 12 }}>
                {editorOpen && (
                  <TextArea
                    value={block.content}
                    onChange={e => updateMdBlock(idx, e.target.value)}
                    placeholder="输入 Markdown 内容..."
                    autoSize={{ minRows: 6, maxRows: 20 }}
                    style={{ fontFamily: 'monospace', marginBottom: 8 }}
                  />
                )}
                {hasContent && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <Input
                        size="small"
                        placeholder="搜索文档内容..."
                        prefix={<SearchOutlined />}
                        allowClear
                        value={searchKeyword}
                        onChange={e => setSearchKeyword(e.target.value)}
                        onClear={() => setSearchKeyword('')}
                        style={{ maxWidth: 300 }}
                      />
                    </div>
                    <div className="markdown-body" style={{ padding: 12, border: '1px solid #f0f0f0', borderRadius: 6, background: '#fafafa' }}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>{previewMd}</ReactMarkdown>
                    </div>
                  </>
                )}
              </div>
            );
          }
          return (
            <Card key={block.id || `faq-${idx}`} size="small" style={{ marginBottom: 12 }}
              extra={<Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => removeFaqCard(idx)} />}
              title={<Space><RobotOutlined style={{ color: '#1890ff' }} />{block.question || 'AI回答'}</Space>}
            >
              <div style={{ whiteSpace: 'pre-wrap' }}>{block.content}</div>
              {block.citations && block.citations.length > 0 && (
                <>
                  <Divider style={{ margin: '8px 0' }} />
                  <div style={{ fontSize: 12, color: '#999' }}>
                    引用：{block.citations.map((c, i) => (
                      <span key={i}>{c.summary}{i < block.citations!.length - 1 ? '、' : ''}</span>
                    ))}
                  </div>
                </>
              )}
            </Card>
          );
        })}
      </div>

      {chatOpen && (
        <div style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          width: 360,
          background: '#fff',
          borderRadius: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
          zIndex: 1000,
          overflow: 'hidden',
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '8px 12px',
            background: '#fafafa',
            borderBottom: '1px solid #f0f0f0',
          }}>
            <Space><RobotOutlined style={{ color: '#1890ff' }} /> AI助手</Space>
            <Button type="text" size="small" icon={<UpOutlined />} onClick={() => setChatOpen(false)}>收起</Button>
          </div>
          <div style={{ padding: 12 }}>
            <TextArea
              value={question}
              onChange={e => setQuestion(e.target.value)}
              placeholder="提问关于此攻关单的问题..."
              autoSize={{ minRows: 3, maxRows: 6 }}
              onPressEnter={e => { if (!e.shiftKey) { e.preventDefault(); handleAsk(); } }}
              style={{ marginBottom: 8 }}
            />
            <Button type="primary" icon={<SendOutlined />} loading={chatLoading} onClick={handleAsk} block size="small">
              提问
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
