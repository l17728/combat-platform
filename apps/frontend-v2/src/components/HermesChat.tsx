import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FloatButton, Drawer, Input, Button, Spin, Empty, Tag, Typography, Space } from 'antd';
import { RobotOutlined, SendOutlined, UserOutlined } from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../api.js';

const { Text } = Typography;

interface Citation { nodeId: string; nodeType: string; summary: string; link: string }
interface Msg { role: 'user' | 'assistant'; text: string; citations?: Citation[] }

/**
 * 可复用浮动 AI 问答。底层即 /hermes/ask(与攻关详情 AI 助手同一能力):
 * agent 开启时为 opencode 知识图谱问答,否则规则引擎;返回答案 + 可点击溯源引用。
 */
export default function HermesChat({
  title = 'AI 问答',
  placeholder = '基于知识库提问,如:PB-xxx 谁负责 / 最近的攻关单 / 某人贡献了什么',
  bottom = 88,
}: { title?: string; placeholder?: string; bottom?: number }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [msgs, loading]);

  const ask = async () => {
    const question = q.trim();
    if (!question || loading) return;
    setMsgs((m) => [...m, { role: 'user', text: question }]);
    setQ('');
    setLoading(true);
    try {
      const res = await api.hermesAsk(question);
      setMsgs((m) => [...m, { role: 'assistant', text: res.answer || '未找到相关记录。', citations: res.citations }]);
    } catch (e: any) {
      setMsgs((m) => [...m, { role: 'assistant', text: `出错了:${e.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <FloatButton
        icon={<RobotOutlined />}
        type="primary"
        tooltip={title}
        onClick={() => setOpen(true)}
        style={{ right: 24, bottom }}
      />
      <Drawer
        title={<Space><RobotOutlined style={{ color: '#1677ff' }} />{title}</Space>}
        open={open}
        onClose={() => setOpen(false)}
        width={440}
        styles={{ body: { display: 'flex', flexDirection: 'column', padding: 12 } }}
      >
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
                          {m.citations.map((c) => (
                            <Tag key={c.nodeId} color="blue" style={{ cursor: 'pointer', margin: 0 }} onClick={() => { setOpen(false); navigate(c.link); }}>
                              {c.summary}
                            </Tag>
                          ))}
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
          onPressEnter={(e) => { if (!e.shiftKey) { e.preventDefault(); ask(); } }}
          disabled={loading}
        />
        <Button type="primary" icon={<SendOutlined />} block style={{ marginTop: 8 }} loading={loading} onClick={ask}>
          提问
        </Button>
      </Drawer>
    </>
  );
}
