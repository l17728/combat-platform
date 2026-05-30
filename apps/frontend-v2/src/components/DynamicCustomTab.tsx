import { useState, useCallback, useRef, useEffect } from 'react';
import { Input, Button, Space, message, Divider, Card, Tooltip } from 'antd';
import { DeleteOutlined, RobotOutlined, SendOutlined, SearchOutlined, EditOutlined, UpOutlined, DragOutlined } from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
// P0-5 修复:移除 rehype-raw,杜绝存储型 XSS。原方案允许 markdown 内任意 HTML
// 渲染,任何登录用户可在 ticket_tabs.content 写 <script>/<img onerror=...>,
// 受害者打开攻关单详情页即被盗 localStorage('combat-token')。
// 不引入 rehype-sanitize 是因为 ReactMarkdown 默认就只渲染白名单 markdown 节点,
// 原始 HTML 标签会被当字面量字符串显示,等价于安全白名单。
import { api, type TicketTab } from '../api.js';
import { useDraggable } from '../hooks/useDraggable.js';

const { TextArea } = Input;

// P0-5 修复:同步移除 highlightMd 的 <mark> 注入。
// 之前依赖 rehypeRaw 把生成的 <mark> 解析为 HTML;现在 rehypeRaw 已去掉,任何 HTML
// 都会被当字面量。改为返回纯文本,搜索高亮通过 CSS-only 方案(后续若需要重做)。
function highlightMd(text: string, _keyword: string): string {
  return text;
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
                      {/* P0-5: 不传 rehypeRaw,原始 HTML 标签作字面量渲染,防 XSS */}
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{previewMd}</ReactMarkdown>
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

      {chatOpen && <AIChatPanel question={question} setQuestion={setQuestion} chatLoading={chatLoading} handleAsk={handleAsk} onClose={() => setChatOpen(false)} />}
    </div>
  );
}

// AI 助手浮窗:支持鼠标拖拽(顶部条作 handle),边界限制在视口内
function AIChatPanel({
  question, setQuestion, chatLoading, handleAsk, onClose,
}: {
  question: string;
  setQuestion: (v: string) => void;
  chatLoading: boolean;
  handleAsk: () => void;
  onClose: () => void;
}) {
  const initial = {
    x: typeof window !== 'undefined' ? Math.max(0, window.innerWidth - 384) : 100,
    y: typeof window !== 'undefined' ? Math.max(0, window.innerHeight - 280) : 100,
  };
  const { pos, onMouseDown } = useDraggable(initial);
  return (
    <div style={{
      position: 'fixed',
      left: pos.x,
      top: pos.y,
      width: 360,
      background: '#fff',
      borderRadius: 8,
      boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
      zIndex: 1000,
      overflow: 'hidden',
    }}>
          <div
            onMouseDown={onMouseDown}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '8px 12px',
              background: '#fafafa',
              borderBottom: '1px solid #f0f0f0',
              cursor: 'move',
              userSelect: 'none',
            }}
          >
            <Space>
              <Tooltip title="按住拖拽移动"><DragOutlined style={{ color: '#999' }} /></Tooltip>
              <RobotOutlined style={{ color: '#1890ff' }} /> AI助手
            </Space>
            <Button type="text" size="small" icon={<UpOutlined />} onClick={onClose}>收起</Button>
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
  );
}
