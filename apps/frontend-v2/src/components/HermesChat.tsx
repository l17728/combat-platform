import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FloatButton, Input, Button, Spin, Empty, Tag, Typography, Space, Tooltip } from 'antd';
import { RobotOutlined, SendOutlined, UserOutlined, CloseOutlined, DragOutlined } from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../api.js';
import { useDraggable } from '../hooks/useDraggable.js';

const { Text } = Typography;

interface Citation {
  nodeId: string;
  nodeType: string;
  summary: string;
  link: string;
  kind?: 'node' | 'welink';
  messageId?: string;
  ticketId?: string;
}
interface Msg { role: 'user' | 'assistant'; text: string; citations?: Citation[] }

/**
 * 可复用浮动 AI 问答。底层即 /hermes/ask(与攻关详情 AI 助手同一能力):
 * agent 开启时为 opencode 知识图谱问答,否则规则引擎;返回答案 + 可点击溯源引用。
 */
export default function HermesChat({
  title = 'AI 问答',
  placeholder = '基于知识库提问,如:PB-xxx 谁负责 / 最近的攻关单 / 某人贡献了什么',
  bottom = 88,
  context,
  greeting,
  testId,
}: {
  title?: string;
  placeholder?: string;
  bottom?: number;
  /** 透传给 /hermes/ask 的上下文(如"当前攻关单 id=xxx") */
  context?: string;
  /** 浮窗打开时由 AI 先发一条欢迎/提示语,可作场景 4 的 gap-analysis 入口 */
  greeting?: string;
  /** Playwright 选择器 */
  testId?: string;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [msgs, loading]);

  const ask = async (raw?: string) => {
    const question = (raw ?? q).trim();
    if (!question || loading) return;
    setMsgs((m) => [...m, { role: 'user', text: question }]);
    setQ('');
    setLoading(true);
    try {
      const res = await api.hermesAsk(question, context);
      setMsgs((m) => [...m, { role: 'assistant', text: res.answer || '未找到相关记录。', citations: res.citations }]);
    } catch (e: any) {
      setMsgs((m) => [...m, { role: 'assistant', text: `出错了:${e.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  // 打开浮窗后,若提供了 greeting 且尚无消息,主动追加一条 assistant 欢迎语
  useEffect(() => {
    if (open && greeting && msgs.length === 0) {
      setMsgs([{ role: 'assistant', text: greeting }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, greeting]);

  const initial = {
    x: typeof window !== 'undefined' ? Math.max(0, window.innerWidth - 464) : 100,
    y: typeof window !== 'undefined' ? Math.max(80, window.innerHeight - 560) : 100,
  };
  const { pos, onMouseDown } = useDraggable(initial);

  return (
    <>
      <FloatButton
        icon={<RobotOutlined />}
        type="primary"
        tooltip={title}
        onClick={() => setOpen(true)}
        style={{ right: 24, bottom }}
        data-testid={testId}
      />
      {open && (
        <div
          style={{
            position: 'fixed',
            left: pos.x,
            top: pos.y,
            width: 440,
            maxHeight: '80vh',
            background: '#fff',
            borderRadius: 8,
            boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
            zIndex: 1100,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div
            onMouseDown={onMouseDown}
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '10px 16px', background: '#fafafa', borderBottom: '1px solid #f0f0f0',
              cursor: 'move', userSelect: 'none',
            }}
          >
            <Space>
              <Tooltip title="按住拖拽移动"><DragOutlined style={{ color: '#999' }} /></Tooltip>
              <RobotOutlined style={{ color: '#1677ff' }} /><Text strong>{title}</Text>
            </Space>
            <Button type="text" size="small" icon={<CloseOutlined />} onClick={() => setOpen(false)} />
          </div>
          <div style={{ padding: 12, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <div ref={listRef} style={{ flex: 1, overflowY: 'auto', marginBottom: 12 }}>
          {msgs.length === 0 && !loading && (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="向 AI 提问,基于知识库作答并给出可点击的来源" />
          )}
          {msgs.map((m, i) => (
            <div key={i} style={{ marginBottom: 12, display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{
                maxWidth: '86%',
                padding: '8px 12px',
                borderRadius: 8,
                background: m.role === 'user' ? '#1677ff' : '#f5f5f5',
                color: m.role === 'user' ? '#fff' : 'inherit',
              }}>
                {m.role === 'assistant' ? (
                  <>
                    <div className="markdown-body" style={{ fontSize: 13 }}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
                    </div>
                    {m.citations && m.citations.length > 0 && (
                      <div style={{ marginTop: 6 }}>
                        <Text type="secondary" style={{ fontSize: 11 }}>来源:</Text>{' '}
                        <Space size={[4, 4]} wrap>
                          {m.citations.map((c) => {
                            const isWelink = c.kind === 'welink';
                            return (
                              <Tooltip key={c.nodeId} title={isWelink ? '点击跳转到该群消息(将自动滚动并高亮)' : '点击跳转到该节点详情'}>
                                <Tag
                                  color={isWelink ? 'geekblue' : 'blue'}
                                  style={{ cursor: 'pointer', margin: 0 }}
                                  data-testid={isWelink ? 'hermes-welink-citation' : 'hermes-node-citation'}
                                  data-welink-msg-id={c.messageId}
                                  onClick={() => { setOpen(false); navigate(c.link); }}
                                >
                                  {isWelink ? '群消息 · ' : ''}{c.summary}
                                </Tag>
                              </Tooltip>
                            );
                          })}
                        </Space>
                      </div>
                    )}
                  </>
                ) : (
                  <span><UserOutlined style={{ marginRight: 4 }} />{m.text}</span>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#999', fontSize: 13 }}>
              <Spin size="small" /> AI 正在分析知识库…(深度问答可能需要一会儿)
            </div>
          )}
        </div>
        <Input.TextArea
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          autoSize={{ minRows: 2, maxRows: 4 }}
          onPressEnter={(e) => { if (!e.shiftKey) { e.preventDefault(); void ask(); } }}
          disabled={loading}
        />
        <Button type="primary" icon={<SendOutlined />} block style={{ marginTop: 8 }} loading={loading} onClick={() => void ask()}>
          提问
        </Button>
          </div>
        </div>
      )}
    </>
  );
}
