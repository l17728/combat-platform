import { useEffect, useState, useCallback } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  Typography,
  List,
  Select,
  Space,
  Empty,
  Skeleton,
  Tag,
  Button,
  Modal,
  Form,
  Input,
  message,
  Popconfirm,
} from "antd";
import { ArrowLeftOutlined, LinkOutlined, DeleteOutlined } from "@ant-design/icons";
import { api } from "../api.js";
import type { RelatedResult } from "../api.js";
import type { ManualLinkView, GraphNode } from "@combat/shared";
import { useGuestGuard } from "../hooks/useGuestGuard.js";
import HelpButton from "../components/HelpButton.js";
import HELP from "../help-content.js";
import { NODE_TYPE_LABEL } from "../constants.js";
import { handleApiError } from "../utils/handleApiError.js";

function detailLink(n: GraphNode): string {
  return n.nodeType === "attackTicket" ? `/attack/${n.id}` : `/related/${n.nodeType}/${n.id}`;
}

// 取实体可读名;无名时回退到中文类型名,绝不展示数据库 UUID
function label(n: GraphNode): string {
  const p = n.properties;
  return String(
    p["标题"] ??
      p["攻关单号"] ??
      p["版本号"] ??
      p["名称"] ??
      p["姓名"] ??
      p["name"] ??
      p["贡献人"] ??
      p["组名"] ??
      p["key"] ??
      NODE_TYPE_LABEL[n.nodeType] ??
      n.nodeType
  );
}

export default function RelatedPage() {
  const { nodeType = "", id = "" } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<RelatedResult | null>(null);
  const [node, setNode] = useState<GraphNode | null>(null);
  const [depth, setDepth] = useState(1);
  const [loading, setLoading] = useState(true);
  const { guard } = useGuestGuard();

  const [manualLinks, setManualLinks] = useState<ManualLinkView[]>([]);
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualForm] = Form.useForm();
  const [searchResults, setSearchResults] = useState<
    { id: string; nodeType: string; summary: string; score: number }[]
  >([]);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const fetchManualLinks = useCallback(() => {
    if (!id) return;
    api
      .listManualRelations(id)
      .then(setManualLinks)
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    api
      .getNode(id)
      .then(setNode)
      .catch(() => setNode(null));
  }, [id]);

  useEffect(() => {
    setLoading(true);
    api
      .getRelated(nodeType, id, { includeCandidates: true, depth })
      .then(setData)
      .catch(() => setData({ outgoing: [], incoming: [] }))
      .finally(() => setLoading(false));
  }, [nodeType, id, depth]);

  useEffect(() => {
    fetchManualLinks();
  }, [fetchManualLinks]);

  const handleSearchTarget = async (q: string) => {
    if (!q.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const results = await api.searchNodes(q);
      setSearchResults(results.filter((n) => n.id !== id).slice(0, 20));
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const handleCreateManualRelation = async (values: { targetId: string; reason: string }) => {
    if (!guard()) return;
    setSubmitting(true);
    try {
      await api.createManualRelation({ sourceId: id, targetId: values.targetId, reason: values.reason });
      message.success("手动关联已创建");
      setManualModalOpen(false);
      manualForm.resetFields();
      setSearchResults([]);
      fetchManualLinks();
    } catch (e) {
      handleApiError(e);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteManualRelation = async (edgeId: string) => {
    if (!guard()) return;
    try {
      await api.deleteManualRelation(edgeId);
      message.success("关联已删除");
      fetchManualLinks();
    } catch (e) {
      handleApiError(e);
    }
  };

  if (loading) return <Skeleton active paragraph={{ rows: 8 }} />;

  const all = [
    ...(data?.incoming ?? []).map((x) => ({ ...x, dir: "← 引用本节点" })),
    ...(data?.outgoing ?? []).map((x) => ({ ...x, dir: "→ 本节点引用" })),
  ];
  const groups: Record<string, typeof all> = {};
  for (const x of all) (groups[x.concept || x.node.nodeType] ??= []).push(x);

  return (
    <div>
      <Button
        type="link"
        icon={<ArrowLeftOutlined />}
        onClick={() => navigate(-1)}
        style={{ paddingLeft: 0, marginBottom: 8 }}
      >
        返回
      </Button>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            关联全景：{node ? label(node) : (NODE_TYPE_LABEL[nodeType] ?? nodeType)}
          </Typography.Title>
          <Tag>{NODE_TYPE_LABEL[nodeType] ?? nodeType}</Tag>
          <HelpButton title={HELP.relatedPage.title} content={HELP.relatedPage.content} />
        </div>
      </div>
      <Space style={{ marginBottom: 16 }}>
        <span>深度：</span>
        <Select
          value={depth}
          onChange={setDepth}
          style={{ width: 80 }}
          options={[
            { value: 1, label: "1" },
            { value: 2, label: "2" },
            { value: 3, label: "3" },
          ]}
        />
        <Button icon={<LinkOutlined />} onClick={() => guard() && setManualModalOpen(true)}>
          手动关联
        </Button>
      </Space>

      {Object.keys(groups).length === 0 && <Empty description="暂无关联" />}
      {Object.entries(groups).map(([nt, items]) => (
        <div key={nt} style={{ marginBottom: 16 }}>
          <Typography.Title level={5}>
            {nt}（{items.length}）
          </Typography.Title>
          <List
            size="small"
            dataSource={items}
            rowKey={(x) => x.node.id + x.field + x.dir}
            renderItem={(x) => (
              <List.Item>
                <Link to={detailLink(x.node)}>{label(x.node)}</Link>
                <span style={{ marginLeft: 8, color: "#888" }}>
                  [{x.field}] {x.dir}
                </span>
              </List.Item>
            )}
          />
        </div>
      ))}

      {data?.candidates && data.candidates.length > 0 && (
        <div style={{ marginTop: 24, borderTop: "1px dashed #d46b08", paddingTop: 12 }}>
          <Typography.Title level={5} style={{ color: "#d46b08" }}>
            候选关系（待审批）
          </Typography.Title>
          <List
            size="small"
            dataSource={data.candidates}
            rowKey={(c) => c.proposalId}
            renderItem={(c) => (
              <List.Item>
                <Link to={detailLink(c.node)}>{label(c.node)}</Link>
                <span style={{ marginLeft: 8, color: "#d46b08" }}>
                  [{c.relationType} {Math.round(c.confidence * 100)}%] {c.rationale}
                </span>
              </List.Item>
            )}
          />
        </div>
      )}

      {data?.coAnchored && data.coAnchored.length > 0 && (
        <div style={{ marginTop: 24, borderTop: "1px dashed #1677ff", paddingTop: 12 }}>
          <Typography.Title level={5} style={{ color: "#1677ff" }}>
            跨颗粒度（共享锚点）
          </Typography.Title>
          <List
            size="small"
            dataSource={data.coAnchored}
            rowKey={(c) => c.node.id + c.anchorKind + c.anchorKey}
            renderItem={(c) => (
              <List.Item>
                <Link to={detailLink(c.node)}>{label(c.node)}</Link>
                <span style={{ marginLeft: 8, color: "#1677ff" }}>
                  [{c.anchorKind}:{c.anchorKey}]
                </span>
              </List.Item>
            )}
          />
        </div>
      )}

      {data?.expanded && data.expanded.length > 0 && (
        <div style={{ marginTop: 24, borderTop: "1px dashed #389e0d", paddingTop: 12 }}>
          <Typography.Title level={5} style={{ color: "#389e0d" }}>
            扩展（深度 {depth}）
          </Typography.Title>
          <List
            size="small"
            dataSource={data.expanded}
            rowKey={(x) => x.node.id + x.depth + x.viaEdgeType + x.viaField}
            renderItem={(x) => (
              <List.Item>
                <Link to={detailLink(x.node)}>{label(x.node)}</Link>
                <span style={{ marginLeft: 8, color: "#389e0d" }}>
                  [深度 {x.depth} · {x.viaEdgeType}
                  {x.viaField ? ` · ${x.viaField}` : ""}]
                </span>
              </List.Item>
            )}
          />
        </div>
      )}

      {manualLinks.length > 0 && (
        <div style={{ marginTop: 24, borderTop: "1px dashed #722ed1", paddingTop: 12 }}>
          <Typography.Title level={5} style={{ color: "#722ed1" }}>
            手动关联（{manualLinks.length}）
          </Typography.Title>
          <List
            size="small"
            dataSource={manualLinks}
            rowKey={(m) => m.edgeId}
            renderItem={(m) => (
              <List.Item
                actions={[
                  <Popconfirm key="del" title="确认删除此关联？" onConfirm={() => handleDeleteManualRelation(m.edgeId)}>
                    <a style={{ color: "#ff4d4f" }}>
                      <DeleteOutlined /> 删除
                    </a>
                  </Popconfirm>,
                ]}
              >
                <Link to={detailLink(m.node)}>{label(m.node)}</Link>
                <span style={{ marginLeft: 8, color: "#722ed1" }}>
                  <Tag color="purple">{m.direction === "out" ? "→ 引用" : "← 被引用"}</Tag>
                  {m.reason && <span style={{ color: "#888" }}>{m.reason}</span>}
                </span>
              </List.Item>
            )}
          />
        </div>
      )}

      {data?.conflicts && data.conflicts.length > 0 && (
        <div style={{ marginTop: 24, borderTop: "2px dashed #cf1322", paddingTop: 12 }}>
          <Typography.Title level={5} style={{ color: "#cf1322" }}>
            冲突 / 重叠
          </Typography.Title>
          <List
            size="small"
            dataSource={data.conflicts}
            rowKey={(c) => c.node.id + c.edgeType + c.reason}
            renderItem={(c) => (
              <List.Item>
                <Link to={detailLink(c.node)}>{label(c.node)}</Link>
                <span style={{ marginLeft: 8, color: "#cf1322" }}>
                  [{c.edgeType === "冲突" ? "冲突" : "重叠"} · {c.reason}]
                </span>
              </List.Item>
            )}
          />
        </div>
      )}

      <Modal
        title="手动关联"
        open={manualModalOpen}
        onCancel={() => {
          setManualModalOpen(false);
          manualForm.resetFields();
          setSearchResults([]);
        }}
        footer={null}
        destroyOnClose
      >
        <Form form={manualForm} layout="vertical" onFinish={handleCreateManualRelation}>
          <Form.Item label="源节点">
            <Input disabled value={node ? label(node) : id} />
          </Form.Item>
          <Form.Item name="targetId" label="目标节点" rules={[{ required: true, message: "请搜索并选择目标节点" }]}>
            <Select
              showSearch
              filterOption={false}
              placeholder="输入名称搜索..."
              onSearch={handleSearchTarget}
              loading={searching}
              notFoundContent={searching ? "搜索中..." : "无结果"}
              options={searchResults.map((n) => ({
                value: n.id,
                label: `${n.summary} (${NODE_TYPE_LABEL[n.nodeType] ?? n.nodeType})`,
              }))}
            />
          </Form.Item>
          <Form.Item name="reason" label="关联原因">
            <Input.TextArea rows={2} placeholder="如：技术顾问、共享客户等" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0, textAlign: "right" }}>
            <Space>
              <Button
                onClick={() => {
                  setManualModalOpen(false);
                  manualForm.resetFields();
                  setSearchResults([]);
                }}
              >
                取消
              </Button>
              <Button type="primary" htmlType="submit" loading={submitting}>
                创建关联
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
