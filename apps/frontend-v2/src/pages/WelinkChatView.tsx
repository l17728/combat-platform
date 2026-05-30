import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Avatar, Button, DatePicker, Empty, Image, Select, Skeleton, Space, Typography, message,
} from 'antd';
import { VerticalAlignTopOutlined, VerticalAlignBottomOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { api, type WelinkMessage, type WelinkImage } from '../api.js';

const { Text } = Typography;

interface Props {
  ticketId: string;
  messages: WelinkMessage[];
  reload: () => Promise<void> | void;
  loading?: boolean;
}

// 简单 hash → 0-360 hue,给每个发言人稳定颜色
function senderHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h % 360;
}

function avatarStyle(s: string): React.CSSProperties {
  const hue = senderHue(s);
  return {
    backgroundColor: `hsl(${hue}, 55%, 55%)`,
    verticalAlign: 'middle',
  };
}

function shortLabel(name: string): string {
  if (!name) return '?';
  // 中文姓名取首字;工号取末两位
  const cn = name.match(/[一-龥]/);
  if (cn) return cn[0];
  return name.slice(-2).toUpperCase();
}

const URL_REGEX = /(https?:\/\/[^\s<>"']+)/g;
const MENTION_REGEX = /(@[^\s@:,，。;；!！?？]+)/g;

// 把文本切成 [文本/链接/@提及] 段,渲染为 React 节点
function renderRichText(text: string): React.ReactNode[] {
  if (!text) return [];
  const out: React.ReactNode[] = [];
  // 先按链接切
  const parts = text.split(URL_REGEX);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    if (URL_REGEX.test(part)) {
      // 重置 lastIndex
      URL_REGEX.lastIndex = 0;
      out.push(
        <a
          key={`url-${i}`}
          href={part}
          target="_blank"
          rel="noreferrer noopener"
          style={{ color: '#1677ff', wordBreak: 'break-all' }}
        >
          {part}
        </a>,
      );
    } else {
      // 在非链接段里再切 @提及
      const subs = part.split(MENTION_REGEX);
      for (let j = 0; j < subs.length; j++) {
        const sub = subs[j];
        if (!sub) continue;
        if (MENTION_REGEX.test(sub)) {
          MENTION_REGEX.lastIndex = 0;
          out.push(
            <span key={`mention-${i}-${j}`} style={{ color: '#1677ff', fontWeight: 500 }}>
              {sub}
            </span>,
          );
        } else {
          out.push(<span key={`txt-${i}-${j}`}>{sub}</span>);
        }
      }
    }
  }
  return out;
}

// 分组同发言人 5 分钟内连续消息
interface MessageGroup {
  key: string;
  sender: string;
  messages: WelinkMessage[];
  firstAt: string;
}

function groupMessages(list: WelinkMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  for (const m of list) {
    const last = groups[groups.length - 1];
    const within5min = last && last.sender === m.author && (
      Math.abs(new Date(m.sentAt).getTime() - new Date(last.messages[last.messages.length - 1].sentAt).getTime())
      <= 5 * 60 * 1000
    );
    if (within5min) {
      last.messages.push(m);
    } else {
      groups.push({ key: m.id, sender: m.author, messages: [m], firstAt: m.sentAt });
    }
  }
  return groups;
}

// 按天分隔(同 yyyy-MM-dd 算一组)
interface DaySection {
  date: string;
  groups: MessageGroup[];
}

function sectionByDate(groups: MessageGroup[]): DaySection[] {
  const sections: DaySection[] = [];
  for (const g of groups) {
    const day = dayjs(g.firstAt).isValid() ? dayjs(g.firstAt).format('YYYY-MM-DD') : g.firstAt;
    const last = sections[sections.length - 1];
    if (last && last.date === day) {
      last.groups.push(g);
    } else {
      sections.push({ date: day, groups: [g] });
    }
  }
  return sections;
}

function MessageBubble({ msg, nameMap }: { msg: WelinkMessage; nameMap: Map<string, string> }) {
  const card = msg.contentType === 'CARD_MSG' ? msg.contentJson?.cardContext : null;
  const preMsg = card?.preMsg;
  const replyMsg = card?.replyMsg;

  return (
    <div
      data-testid="welink-bubble"
      data-content-type={msg.contentType}
      style={{
        background: '#f5f5f5',
        borderRadius: 8,
        padding: '8px 12px',
        maxWidth: '70%',
        marginBottom: 6,
        wordBreak: 'break-word',
      }}
    >
      {msg.contentType === 'CARD_MSG' && card ? (
        <>
          {preMsg?.content && (
            <div
              style={{
                background: '#ececec',
                borderLeft: '3px solid #bbb',
                padding: '6px 10px',
                borderRadius: 4,
                marginBottom: 6,
                fontSize: 12,
                color: '#666',
              }}
            >
              <div style={{ fontWeight: 500, marginBottom: 2 }}>
                引用 {preMsg.nameZH || nameMap.get(preMsg.sender || '') || preMsg.sender || '匿名'}:
              </div>
              <div>{renderRichText(String(preMsg.content))}</div>
            </div>
          )}
          <div style={{ whiteSpace: 'pre-wrap' }}>
            {renderRichText(String(replyMsg?.content ?? msg.content ?? ''))}
          </div>
        </>
      ) : msg.contentType === 'PICTURE_MSG' ? (
        <>
          <div style={{ color: '#888', fontSize: 12, marginBottom: 4 }}>{msg.content || '[图片]'}</div>
          <Space wrap>
            {(msg.images || []).map((img: WelinkImage, i) => (
              <Image
                key={`${img.md5 || i}`}
                src={img.url}
                alt={img.filename || `image-${i}`}
                style={{ maxWidth: 200, maxHeight: 200, borderRadius: 4 }}
                data-testid="welink-picture"
              />
            ))}
            {(msg.images || []).length === 0 && (
              <Text type="secondary" style={{ fontSize: 12 }}>(无图片附件)</Text>
            )}
          </Space>
        </>
      ) : (
        <div style={{ whiteSpace: 'pre-wrap' }}>{renderRichText(msg.content)}</div>
      )}
    </div>
  );
}

let personCache: { at: number; map: Map<string, string> } | null = null;
const PERSON_CACHE_TTL = 5 * 60 * 1000;

async function loadPersonMap(): Promise<Map<string, string>> {
  if (personCache && Date.now() - personCache.at < PERSON_CACHE_TTL) {
    return personCache.map;
  }
  const map = new Map<string, string>();
  try {
    const people = await api.listNodes('person');
    for (const p of people) {
      const props = p.properties as Record<string, unknown>;
      const name = String(props.姓名 ?? props.name ?? '').trim();
      const empNo = String(props.工号 ?? props.employeeId ?? props.empNo ?? '').trim();
      const email = String(props.邮箱 ?? props.email ?? '').trim();
      if (name && empNo) map.set(empNo, name);
      if (name && email) map.set(email, name);
      if (name) map.set(name, name);
    }
  } catch {
    // 加载失败,空 map(显示原 sender)
  }
  personCache = { at: Date.now(), map };
  return map;
}

export function clearWelinkPersonCache() {
  personCache = null;
}

export default function WelinkChatView({ messages, reload, loading }: Props) {
  const [nameMap, setNameMap] = useState<Map<string, string>>(new Map());
  const [authorFilter, setAuthorFilter] = useState<string[]>([]);
  const [timeRange, setTimeRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    loadPersonMap().then((m) => { if (!cancelled) setNameMap(m); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const since = timeRange?.[0]?.toISOString();
    const until = timeRange?.[1]?.toISOString();
    return messages.filter((m) => {
      if (authorFilter.length && !authorFilter.includes(m.author)) return false;
      if (since && m.sentAt < since) return false;
      if (until && m.sentAt > until) return false;
      return true;
    });
  }, [messages, authorFilter, timeRange]);

  const authorOptions = useMemo(() => {
    const set = new Set<string>();
    for (const m of messages) if (m.author) set.add(m.author);
    return Array.from(set).map((a) => ({
      value: a,
      label: nameMap.get(a) ? `${nameMap.get(a)} (${a})` : a,
    }));
  }, [messages, nameMap]);

  const sections = useMemo(() => sectionByDate(groupMessages(filtered)), [filtered]);

  const getName = (sender: string): { name: string | null; raw: string } => {
    const name = nameMap.get(sender) || null;
    return { name, raw: sender };
  };

  const scrollToBottom = () => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  };
  const scrollToTop = () => {
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  };

  // 数据加载完默认滚到底部
  useEffect(() => {
    if (!loading && sections.length > 0) {
      const id = setTimeout(scrollToBottom, 50);
      return () => clearTimeout(id);
    }
  }, [loading, sections.length]);

  const handleReload = async () => {
    try {
      clearWelinkPersonCache();
      const m = await loadPersonMap();
      setNameMap(m);
      await reload();
      message.success('已刷新');
    } catch (e: any) {
      message.error(`刷新失败: ${e.message || e}`);
    }
  };

  if (loading && messages.length === 0) {
    return <Skeleton active paragraph={{ rows: 8 }} />;
  }

  return (
    <div data-testid="welink-chat-view">
      <Space wrap style={{ marginBottom: 12 }}>
        <Button size="small" icon={<VerticalAlignTopOutlined />} onClick={scrollToTop}>跳到最早</Button>
        <Button size="small" icon={<VerticalAlignBottomOutlined />} onClick={scrollToBottom}>跳到最新</Button>
        <Button size="small" icon={<ReloadOutlined />} onClick={handleReload}>刷新</Button>
        <DatePicker.RangePicker
          showTime
          size="small"
          value={timeRange as any}
          onChange={(v) => setTimeRange(v as any)}
          placeholder={['起始时间', '截止时间']}
        />
        <Select
          mode="multiple"
          allowClear
          showSearch
          placeholder="发言人筛选"
          size="small"
          style={{ minWidth: 200, maxWidth: 360 }}
          value={authorFilter}
          onChange={setAuthorFilter}
          options={authorOptions}
          filterOption={(input, option) =>
            String(option?.label || '').toLowerCase().includes(input.toLowerCase())
          }
        />
        <Text type="secondary">{filtered.length} / {messages.length} 条</Text>
      </Space>

      <div
        ref={containerRef}
        style={{
          maxHeight: 'calc(100vh - 320px)',
          minHeight: 320,
          overflowY: 'auto',
          padding: '12px 4px',
          background: '#fafafa',
          borderRadius: 6,
        }}
      >
        {sections.length === 0 ? (
          <Empty description="暂无消息" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          sections.map((section) => (
            <div key={section.date}>
              <div
                style={{
                  textAlign: 'center',
                  margin: '12px 0',
                  fontSize: 12,
                  color: '#999',
                }}
                data-testid="welink-date-divider"
              >
                <span style={{ background: '#fafafa', padding: '0 10px' }}>
                  {section.date} {dayjs(section.date).isValid() ? `· ${['周日', '周一', '周二', '周三', '周四', '周五', '周六'][dayjs(section.date).day()]}` : ''}
                </span>
              </div>

              {section.groups.map((g) => {
                const info = getName(g.sender);
                const label = info.name ? `${info.name} · ${info.raw}` : info.raw;
                return (
                  <div key={g.key} style={{ display: 'flex', marginBottom: 14, gap: 10 }}>
                    <Avatar style={avatarStyle(g.sender)}>{shortLabel(info.name || info.raw)}</Avatar>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }} data-testid="welink-sender-line">
                        <Text strong style={{ fontSize: 12 }}>{label}</Text>
                        <Text type="secondary" style={{ marginLeft: 8 }}>
                          {dayjs(g.firstAt).isValid() ? dayjs(g.firstAt).format('HH:mm:ss') : g.firstAt}
                        </Text>
                      </div>
                      {g.messages.map((m) => (
                        <MessageBubble key={m.id} msg={m} nameMap={nameMap} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
