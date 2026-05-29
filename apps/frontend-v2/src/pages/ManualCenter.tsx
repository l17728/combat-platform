import { useState } from 'react';
import { Row, Col, Card, Menu, Typography } from 'antd';
import type { MenuProps } from 'antd';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import HELP from '../help-content.js';

const { Title } = Typography;

const OUTLINE: { group: string; keys: string[] }[] = [
  { group: '总览', keys: ['dashboard'] },
  { group: '攻关管理', keys: ['attackList', 'attackDetail', 'dailyReport'] },
  { group: '人员与荣誉', keys: ['peopleList', 'contributions', 'honor', 'personHonor', 'mergePage'] },
  { group: '协作与文档', keys: ['helpCenter', 'documentCenter'] },
  { group: '审核与提醒', keys: ['proposals', 'reminders'] },
  { group: '检索与关联', keys: ['search', 'relatedPage'] },
  { group: '系统管理', keys: ['importExport', 'schemaWizard', 'configCenter', 'emailSettings', 'auditLog', 'backupRestore', 'userManagement', 'bugReport'] },
];

function stripSuffix(title: string): string {
  return title.replace(/\s*-\s*使用帮助$/, '');
}

export default function ManualCenter() {
  const [activeKey, setActiveKey] = useState('dashboard');

  const menuItems: MenuProps['items'] = OUTLINE.map((cat) => ({
    type: 'group',
    label: cat.group,
    children: cat.keys
      .filter((key) => HELP[key])
      .map((key) => ({ key, label: stripSuffix(HELP[key].title) })),
  }));

  const entry = HELP[activeKey];

  return (
    <div>
      <Title level={4} style={{ marginBottom: 16 }}>帮助中心</Title>
      <Row gutter={16}>
        <Col span={6}>
          <Menu
            mode="inline"
            selectedKeys={[activeKey]}
            onClick={({ key }) => setActiveKey(key)}
            items={menuItems}
            style={{ maxHeight: 'calc(100vh - 180px)', overflow: 'auto', borderRight: 'none' }}
          />
        </Col>
        <Col span={18}>
          {entry && (
            <Card>
              <Title level={5} style={{ marginTop: 0 }}>{stripSuffix(entry.title)}</Title>
              <img
                src={`/manual-shots/${activeKey}.png`}
                style={{ maxWidth: '100%', border: '1px solid #f0f0f0', borderRadius: 6, marginBottom: 16 }}
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              />
              <div className="markdown-body">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>{entry.content}</ReactMarkdown>
              </div>
            </Card>
          )}
        </Col>
      </Row>
    </div>
  );
}
