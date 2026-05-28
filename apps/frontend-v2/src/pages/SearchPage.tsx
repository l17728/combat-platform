import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input, Table, Tag, Typography, Space, Select, Empty, Card, Descriptions, Timeline, Spin, message } from 'antd';
import { SearchOutlined, NodeIndexOutlined } from '@ant-design/icons';
import { api } from '../api.js';
import type { QueryContext } from '../api.js';
import { NODE_TYPE_LABEL } from '../constants.js';
import HelpButton from '../components/HelpButton.js';
import HELP from '../help-content.js';

const { Title, Text, Paragraph } = Typography;
const { Search } = Input;

interface QueryHit {
  id: string;
  nodeType: string;
  summary: string;
  score: number;
}

function ContextPanel({ ctx }: { ctx: QueryContext }) {
  const navigate = useNavigate();
  const props = ctx.node.properties;

  const relatedCount =
    ctx.related.outgoing.length + ctx.related.incoming.length + ctx.related.coAnchored.length;

  return (
    <Card
      size="small"
      title={
        <Space>
          <Text strong>{(props['标题'] || props['名称'] || props['name'] || ctx.node.id) as string}</Text>
          <Tag>{NODE_TYPE_LABEL[ctx.node.nodeType] || ctx.node.nodeType}</Tag>
        </Space>
      }
      extra={
        ctx.node.nodeType === 'attackTicket' && (
          <a onClick={() => navigate(`/attack/${ctx.node.id}`)}>查看详情</a>
        )
      }
      style={{ marginTop: 16 }}
    >
      <Descriptions bordered size="small" column={1}>
        {Object.entries(props)
          .filter(([, v]) => v != null && v !== '')
          .slice(0, 8)
          .map(([k, v]) => (
            <Descriptions.Item key={k} label={k}>
              <Text>{String(v)}</Text>
            </Descriptions.Item>
          ))}
      </Descriptions>

      {relatedCount > 0 && (
        <div style={{ marginTop: 12 }}>
          <Text type="secondary">关联节点 ({relatedCount})</Text>
          <div style={{ marginTop: 4 }}>
            {ctx.related.outgoing.slice(0, 5).map((r) => (
              <Tag key={r.node.id} style={{ marginBottom: 4 }}>
                {r.field}: {(r.node.properties['名称'] || r.node.properties['name'] || r.node.id) as string}
              </Tag>
            ))}
            {ctx.related.incoming.slice(0, 5).map((r) => (
              <Tag key={r.node.id} color="blue" style={{ marginBottom: 4 }}>
                {r.field}: {(r.node.properties['名称'] || r.node.properties['name'] || r.node.id) as string}
              </Tag>
            ))}
          </div>
        </div>
      )}

      {ctx.progress.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <Text type="secondary">最近进展</Text>
          <Timeline
            style={{ marginTop: 8 }}
            items={ctx.progress.slice(-3).map((p) => ({
              children: (
                <div>
                  <Text>{p.content}</Text>
                  <br />
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {p.statusSnapshot} · {new Date(p.updatedAt).toLocaleString()}
                  </Text>
                </div>
              ),
            }))}
          />
        </div>
      )}
    </Card>
  );
}

export default function SearchPage() {
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<QueryHit[]>([]);
  const [selectedType, setSelectedType] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [contextData, setContextData] = useState<QueryContext | null>(null);
  const [contextLoading, setContextLoading] = useState(false);

  const doSearch = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setResults([]);
        setContextData(null);
        return;
      }
      setLoading(true);
      setContextData(null);
      try {
        const data = await api.searchNodes(q, selectedType, 50);
        setResults(data);
      } catch (e: any) {
        message.error(e.message);
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [selectedType],
  );

  const handleRowClick = useCallback(async (record: QueryHit) => {
    setContextLoading(true);
    try {
      const ctx = await api.getContext(record.id);
      setContextData(ctx);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setContextLoading(false);
    }
  }, []);

  const columns = [
    {
      title: '摘要',
      dataIndex: 'summary',
      key: 'summary',
      render: (text: string, record: QueryHit) => (
        <a onClick={() => {
          if (record.nodeType === 'attackTicket') {
            navigate(`/attack/${record.id}`);
          } else {
            handleRowClick(record);
          }
        }}>
          {text}
        </a>
      ),
    },
    {
      title: '类型',
      dataIndex: 'nodeType',
      key: 'nodeType',
      width: 90,
      render: (t: string) => <Tag>{NODE_TYPE_LABEL[t] || t}</Tag>,
    },
    {
      title: '匹配度',
      dataIndex: 'score',
      key: 'score',
      width: 70,
      sorter: (a: QueryHit, b: QueryHit) => a.score - b.score,
      render: (s: number) => (
        <Text type={s >= 3 ? 'danger' : s >= 2 ? 'warning' : undefined}>{s}</Text>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Title level={4} style={{ margin: 0 }}>
            全局搜索
          </Title>
          <HelpButton title={HELP.search.title} content={HELP.search.content} />
        </div>
      </div>

      <Space wrap style={{ marginBottom: 16, width: '100%' }}>
        <Select
          allowClear
          placeholder="筛选类型"
          style={{ width: 140 }}
          value={selectedType}
          onChange={(v) => {
            setSelectedType(v);
            if (keyword) doSearch(keyword);
          }}
          options={[
            { value: 'attackTicket', label: '攻关单' },
            { value: 'person', label: '人员' },
            { value: 'contribution', label: '贡献' },
          ]}
        />
        <Search
          placeholder="搜索关键词（标题、名称、描述等）"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onSearch={doSearch}
          enterButton={<><SearchOutlined /> 搜索</>}
          style={{ width: 400 }}
          size="middle"
          allowClear
        />
      </Space>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin tip="搜索中..." />
        </div>
      ) : results.length === 0 && keyword ? (
        <Empty description="未找到匹配结果" />
      ) : results.length === 0 ? (
        <Empty description="输入关键词开始搜索" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <>
          <Text type="secondary" style={{ marginBottom: 8, display: 'block' }}>
            找到 {results.length} 条结果
          </Text>
          <Table
            rowKey="id"
            dataSource={results}
            columns={columns}
            size="middle"
            pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }}
            onRow={(record) => ({
              onClick: () => handleRowClick(record),
              style: { cursor: 'pointer' },
            })}
          />
        </>
      )}

      {contextLoading && (
        <div style={{ textAlign: 'center', padding: 20 }}>
          <Spin tip="加载上下文..." />
        </div>
      )}
      {contextData && !contextLoading && <ContextPanel ctx={contextData} />}
    </div>
  );
}
