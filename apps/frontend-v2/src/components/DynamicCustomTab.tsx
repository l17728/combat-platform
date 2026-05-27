import { useState, useCallback, useRef, useEffect } from 'react';
import { Input, Button, Space, Popconfirm, message, Divider, Card, Empty, Spin, Collapse } from 'antd';
import { DeleteOutlined, RobotOutlined, SendOutlined, ExpandOutlined, ShrinkOutlined } from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import { api, type TicketTab } from '../api.js';

const { TextArea } = Input;

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
      const result = await api.hermesAsk(question);
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

  const handleDeleteTab = async () => {
    try {
      await api.deleteTicketTab(ticketId, tab.id);
      message.success('标签已删除');
      onDeleted(tab.id);
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const mdBlockIndex = blocks.findIndex(b => b.type === 'markdown');

  return (
    <div style={{ padding: '16px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <Space>
          <Button size="small" icon={chatOpen ? <ShrinkOutlined /> : <ExpandOutlined />} onClick={() => setChatOpen(!chatOpen)}>
            {chatOpen ? '收起AI助手' : 'AI助手'}
          </Button>
        </Space>
        <Popconfirm title="确认删除此标签？" onConfirm={handleDeleteTab}>
          <Button size="small" danger icon={<DeleteOutlined />}>删除标签</Button>
        </Popconfirm>
      </div>

      <div style={{ display: 'flex', gap: 16 }}>
        <div style={{ flex: 1 }}>
          {blocks.map((block, idx) => {
            if (block.type === 'markdown') {
              return (
                <div key={`md-${idx}`} style={{ marginBottom: 12 }}>
                  <TextArea
                    value={block.content}
                    onChange={e => updateMdBlock(idx, e.target.value)}
                    placeholder="输入 Markdown 内容..."
                    autoSize={{ minRows: 6, maxRows: 20 }}
                    style={{ fontFamily: 'monospace' }}
                  />
                  {block.content && (
                    <div style={{ marginTop: 8, padding: 12, border: '1px solid #f0f0f0', borderRadius: 6, background: '#fafafa' }}>
                      <ReactMarkdown>{block.content}</ReactMarkdown>
                    </div>
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
          <div style={{ width: 320, flexShrink: 0 }}>
            <Card size="small" title={<Space><RobotOutlined /> AI助手</Space>} style={{ position: 'sticky', top: 0 }}>
              <div style={{ marginBottom: 8 }}>
                <TextArea
                  value={question}
                  onChange={e => setQuestion(e.target.value)}
                  placeholder="提问关于此攻关单的问题..."
                  autoSize={{ minRows: 3, maxRows: 6 }}
                  onPressEnter={e => { if (!e.shiftKey) { e.preventDefault(); handleAsk(); } }}
                />
              </div>
              <Button type="primary" icon={<SendOutlined />} loading={chatLoading} onClick={handleAsk} block size="small">
                提问
              </Button>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
