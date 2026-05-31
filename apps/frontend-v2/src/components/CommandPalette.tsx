import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal, Input, List, Typography, Tag, Space } from 'antd';
import {
  DashboardOutlined,
  ThunderboltOutlined,
  TeamOutlined,
  TrophyOutlined,
  MailOutlined,
  FileTextOutlined,
  SearchOutlined,
  DeploymentUnitOutlined,
  BugOutlined,
  QuestionCircleOutlined,
  PlusOutlined,
  RightOutlined,
} from '@ant-design/icons';

const { Text } = Typography;

type Cmd = {
  id: string;
  label: string;
  hint?: string;
  keywords?: string;
  icon: React.ReactNode;
  group: '导航' | '操作' | '搜索';
  action: (navigate: ReturnType<typeof useNavigate>, query: string) => void;
};

const BASE_COMMANDS: Cmd[] = [
  { id: 'go-dashboard', label: '作战态势', hint: '/', keywords: 'dashboard home zhanyi', icon: <DashboardOutlined />, group: '导航', action: (nav) => nav('/') },
  { id: 'go-attack', label: '攻关作战台', hint: '/attack', keywords: 'attack ticket gongguan', icon: <ThunderboltOutlined />, group: '导航', action: (nav) => nav('/attack') },
  { id: 'go-daily', label: '攻关日报', hint: '/daily-report', keywords: 'daily report ribao', icon: <FileTextOutlined />, group: '导航', action: (nav) => nav('/daily-report') },
  { id: 'go-people', label: '全员名单', hint: '/people', keywords: 'people renyuan team', icon: <TeamOutlined />, group: '导航', action: (nav) => nav('/people') },
  { id: 'go-contributions', label: '贡献录入', hint: '/contributions', keywords: 'contribution gongxian', icon: <TrophyOutlined />, group: '导航', action: (nav) => nav('/contributions') },
  { id: 'go-honor', label: '荣誉殿堂', hint: '/honor', keywords: 'honor rongyu', icon: <TrophyOutlined />, group: '导航', action: (nav) => nav('/honor') },
  { id: 'go-help', label: '求助中心', hint: '/help', keywords: 'help qiuzhu', icon: <MailOutlined />, group: '导航', action: (nav) => nav('/help') },
  { id: 'go-search', label: '全局搜索', hint: '/search', keywords: 'search quanju', icon: <SearchOutlined />, group: '导航', action: (nav) => nav('/search') },
  { id: 'go-kg', label: '知识图谱', hint: '/kg', keywords: 'kg knowledge graph zhishi tupu', icon: <DeploymentUnitOutlined />, group: '导航', action: (nav) => nav('/kg') },
  { id: 'go-documents', label: '文档中心', hint: '/documents', keywords: 'documents wendang', icon: <FileTextOutlined />, group: '导航', action: (nav) => nav('/documents') },
  { id: 'go-bug', label: '问题反馈', hint: '/bug-report', keywords: 'bug feedback wenti', icon: <BugOutlined />, group: '导航', action: (nav) => nav('/bug-report') },
  { id: 'go-manual', label: '帮助中心', hint: '/manual', keywords: 'manual help bangzhu', icon: <QuestionCircleOutlined />, group: '导航', action: (nav) => nav('/manual') },
  {
    id: 'new-attack',
    label: '新建攻关单',
    hint: '在攻关作战台打开新建抽屉',
    keywords: 'new create attack xinjian',
    icon: <PlusOutlined />,
    group: '操作',
    action: (nav) => nav('/attack?new=1'),
  },
];

function matchScore(cmd: Cmd, q: string): number {
  if (!q) return 1;
  const text = `${cmd.label} ${cmd.keywords || ''} ${cmd.hint || ''}`.toLowerCase();
  const lower = q.toLowerCase();
  if (cmd.label.toLowerCase().startsWith(lower)) return 100;
  if (text.includes(lower)) return 50;
  // 简单字符顺序模糊
  let i = 0;
  for (const ch of text) {
    if (ch === lower[i]) i++;
    if (i >= lower.length) return 10;
  }
  return 0;
}

export default function CommandPalette() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isK = (e.key === 'k' || e.key === 'K');
      if (isK && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const all = [...BASE_COMMANDS];
    if (q.trim()) {
      all.push({
        id: 'search-query',
        label: `搜索 "${q.trim()}"`,
        hint: '跳转全局搜索',
        icon: <SearchOutlined />,
        group: '搜索',
        action: (nav, query) => nav(`/search?q=${encodeURIComponent(query)}`),
      });
    }
    return all
      .map((c) => ({ c, s: matchScore(c, q.trim()) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.c);
  }, [q]);

  useEffect(() => {
    if (active >= filtered.length) setActive(0);
  }, [filtered.length, active]);

  const run = useCallback(
    (cmd: Cmd) => {
      setOpen(false);
      cmd.action(navigate, q.trim());
    },
    [navigate, q],
  );

  return (
    <Modal
      open={open}
      onCancel={() => setOpen(false)}
      footer={null}
      title={null}
      closable={false}
      width={620}
      destroyOnClose
      styles={{ body: { padding: 0 } }}
    >
      <div style={{ padding: 12, borderBottom: '1px solid #f0f0f0' }}>
        <Input
          autoFocus
          size="large"
          variant="borderless"
          placeholder="输入命令或页面名…按 Enter 执行,Esc 关闭"
          prefix={<SearchOutlined style={{ color: '#999' }} />}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((i) => Math.min(filtered.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const cmd = filtered[active];
              if (cmd) run(cmd);
            }
          }}
        />
      </div>
      <div style={{ maxHeight: 420, overflowY: 'auto' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#999' }}>未找到匹配命令</div>
        ) : (
          <List
            dataSource={filtered}
            renderItem={(cmd, idx) => (
              <List.Item
                key={cmd.id}
                onMouseEnter={() => setActive(idx)}
                onClick={() => run(cmd)}
                style={{
                  cursor: 'pointer',
                  padding: '10px 16px',
                  background: idx === active ? '#f5f5f5' : 'transparent',
                  borderBottom: 'none',
                }}
              >
                <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                  <Space>
                    <span style={{ color: '#1677ff', fontSize: 16 }}>{cmd.icon}</span>
                    <Text strong>{cmd.label}</Text>
                    {cmd.hint && <Text type="secondary" style={{ fontSize: 12 }}>{cmd.hint}</Text>}
                  </Space>
                  <Space>
                    <Tag color={cmd.group === '导航' ? 'blue' : cmd.group === '操作' ? 'green' : 'purple'}>{cmd.group}</Tag>
                    {idx === active && <RightOutlined style={{ fontSize: 10, color: '#999' }} />}
                  </Space>
                </Space>
              </List.Item>
            )}
          />
        )}
      </div>
      <div
        style={{
          padding: '8px 16px',
          borderTop: '1px solid #f0f0f0',
          background: '#fafafa',
          fontSize: 12,
          color: '#999',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>
          <Tag>↑↓</Tag>切换 <Tag>Enter</Tag>执行 <Tag>Esc</Tag>关闭
        </span>
        <span>
          快捷键 <Tag>Ctrl/⌘ + K</Tag>
        </span>
      </div>
    </Modal>
  );
}
