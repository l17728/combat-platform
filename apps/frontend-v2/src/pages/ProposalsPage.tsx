import { useState, useEffect, useCallback } from 'react';
import {
  Typography,
  Table,
  Tag,
  Space,
  Select,
  Button,
  Popconfirm,
  message,
  Empty,
  Tooltip,
  Card,
  Descriptions,
} from 'antd';
import { ScanOutlined, CheckOutlined, CloseOutlined } from '@ant-design/icons';
import { api } from '../api.js';
import type { RelationProposal } from '../api.js';
import { PROPOSAL_STATUS_COLOR, PAGE_SIZE, PAGE_SIZE_OPTIONS, DATE_FORMAT } from '../constants.js';
import HelpButton from '../components/HelpButton.js';
import HELP from '../help-content.js';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
dayjs.extend(relativeTime);

const { Title, Text } = Typography;

export default function ProposalsPage() {
  const [data, setData] = useState<RelationProposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string | undefined>('待审批');
  const [scanning, setScanning] = useState(false);
  const [detail, setDetail] = useState<RelationProposal | null>(null);
  const [nodesCache, setNodesCache] = useState<Record<string, { name: string; type: string }>>({});

  const fetchData = useCallback(
    async (silent?: boolean) => {
      if (!silent) setLoading(true);
      try {
        const list = await api.listProposals(statusFilter);
        setData(list);

        const missing = new Set<string>();
        list.forEach((p) => {
          if (!nodesCache[p.sourceNodeId]) missing.add(p.sourceNodeId);
          if (!nodesCache[p.targetNodeId]) missing.add(p.targetNodeId);
        });
        if (missing.size > 0) {
          const newCache = { ...nodesCache };
          await Promise.all(
            [...missing].map(async (id) => {
              try {
                const node = await api.getNode(id);
                newCache[id] = {
                  name: (node.properties['名称'] || node.properties['姓名'] || node.properties['name'] || id) as string,
                  type: node.nodeType,
                };
              } catch {
                newCache[id] = { name: id.slice(0, 8), type: '?' };
              }
            }),
          );
          setNodesCache(newCache);
        }
      } catch (e: any) {
        message.error(e.message);
      } finally {
        setLoading(false);
      }
    },
    [statusFilter, nodesCache],
  );

  useEffect(() => {
    fetchData();
  }, [statusFilter]);

  const handleScan = useCallback(async () => {
    setScanning(true);
    try {
      const res = await api.scanProposals();
      message.success(`扫描完成，新增 ${res.created} 条候选关系`);
      fetchData();
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setScanning(false);
    }
  }, [fetchData]);

  const handleDecide = useCallback(
    async (id: string, decision: string) => {
      try {
        await api.decideProposal(id, decision, 'ui');
        message.success(decision === '通过' ? '已通过，人员已合并' : '已拒绝');
        fetchData();
      } catch (e: any) {
        message.error(e.message);
      }
    },
    [fetchData],
  );

  const getNodeName = (id: string) => nodesCache[id]?.name || id.slice(0, 8);

  const columns = [
    {
      title: '来源节点',
      dataIndex: 'sourceNodeId',
      key: 'source',
      render: (id: string, record: RelationProposal) => (
        <Space direction="vertical" size={0}>
          <a onClick={() => setDetail(record)}>{getNodeName(id)}</a>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {nodesCache[id]?.type || ''}
          </Text>
        </Space>
      ),
    },
    {
      title: '关系',
      dataIndex: 'relationType',
      key: 'relation',
      width: 100,
      render: (t: string) => <Tag>{t}</Tag>,
    },
    {
      title: '目标节点',
      dataIndex: 'targetNodeId',
      key: 'target',
      render: (id: string) => (
        <Space direction="vertical" size={0}>
          <Text>{getNodeName(id)}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {nodesCache[id]?.type || ''}
          </Text>
        </Space>
      ),
    },
    {
      title: '置信度',
      dataIndex: 'confidence',
      key: 'confidence',
      width: 80,
      render: (c: number) => (
        <Text type={c >= 0.9 ? 'danger' : c >= 0.7 ? 'warning' : undefined}>
          {(c * 100).toFixed(0)}%
        </Text>
      ),
    },
    {
      title: '依据',
      dataIndex: 'rationale',
      key: 'rationale',
      ellipsis: true,
      render: (t: string) => (
        <Tooltip title={t}>
          <Text style={{ fontSize: 12 }}>{t}</Text>
        </Tooltip>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (s: string) => <Tag color={PROPOSAL_STATUS_COLOR[s]}>{s}</Tag>,
    },
    {
      title: '时间',
      dataIndex: 'createdAt',
      key: 'time',
      width: 140,
      sorter: (a: RelationProposal, b: RelationProposal) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      defaultSortOrder: 'descend' as const,
      render: (t: string) => (
        <Tooltip title={dayjs(t).format(DATE_FORMAT)}>
          <Text style={{ fontSize: 12 }}>{dayjs(t).fromNow()}</Text>
        </Tooltip>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 140,
      fixed: 'right' as const,
      render: (_: unknown, record: RelationProposal) =>
        record.status === '待审批' ? (
          <Space>
            <Popconfirm
              title="确认通过？将执行人员合并操作"
              onConfirm={() => handleDecide(record.id, '通过')}
            >
              <a style={{ color: '#52c41a' }}>
                <CheckOutlined /> 通过
              </a>
            </Popconfirm>
            <Popconfirm
              title="确认拒绝？"
              onConfirm={() => handleDecide(record.id, '拒绝')}
            >
              <a style={{ color: '#ff4d4f' }}>
                <CloseOutlined /> 拒绝
              </a>
            </Popconfirm>
          </Space>
        ) : (
          <Text type="secondary">
            {record.decidedBy ? `${record.decidedBy}` : '-'}
          </Text>
        ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          关系审批
        </Title>
        <Space>
          <HelpButton title={HELP.proposals.title} content={HELP.proposals.content} />
          <Select
            allowClear
            placeholder="状态筛选"
            style={{ width: 120 }}
            value={statusFilter}
            onChange={(v) => setStatusFilter(v)}
            options={[
              { value: '待审批', label: '待审批' },
              { value: '已通过', label: '已通过' },
              { value: '已拒绝', label: '已拒绝' },
            ]}
          />
          <Button icon={<ScanOutlined />} loading={scanning} onClick={handleScan}>
            扫描候选
          </Button>
        </Space>
      </div>

      {detail && (
        <Card
          size="small"
          style={{ marginBottom: 16 }}
          title="提案详情"
          extra={<Button size="small" onClick={() => setDetail(null)}>关闭</Button>}
        >
          <Descriptions bordered size="small" column={2}>
            <Descriptions.Item label="来源">{getNodeName(detail.sourceNodeId)}</Descriptions.Item>
            <Descriptions.Item label="目标">{getNodeName(detail.targetNodeId)}</Descriptions.Item>
            <Descriptions.Item label="关系类型">{detail.relationType}</Descriptions.Item>
            <Descriptions.Item label="置信度">{(detail.confidence * 100).toFixed(0)}%</Descriptions.Item>
            <Descriptions.Item label="依据" span={2}>{detail.rationale}</Descriptions.Item>
            <Descriptions.Item label="来源算法">{detail.proposerSource}</Descriptions.Item>
            <Descriptions.Item label="状态">
              <Tag color={PROPOSAL_STATUS_COLOR[detail.status]}>{detail.status}</Tag>
            </Descriptions.Item>
          </Descriptions>
        </Card>
      )}

      <Table
        rowKey="id"
        dataSource={data}
        columns={columns}
        loading={loading}
        size="middle"
        scroll={{ x: 'max-content' }}
        pagination={{
          pageSize: PAGE_SIZE,
          showSizeChanger: true,
          pageSizeOptions: PAGE_SIZE_OPTIONS,
          showTotal: (t) => `共 ${t} 条`,
        }}
        locale={{ emptyText: <Empty description="暂无候选关系" /> }}
      />
    </div>
  );
}
