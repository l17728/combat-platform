import {
  Button,
  Space,
  Select,
  Empty,
  Spin,
  Row,
  Col,
  Tree,
  Tag,
  Typography,
  Tooltip,
  Popconfirm,
  Card,
  Descriptions,
  Divider,
  List,
  Modal,
  Table,
  message,
} from "antd";
import { PlusOutlined, EditOutlined, DeleteOutlined, SettingOutlined } from "@ant-design/icons";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api.js";
import { useGuestGuard } from "../../hooks/useGuestGuard.js";
import { SUPPORT_STATUS_COLOR, NODE_TYPE_LABEL } from "../../constants.js";
import { nodeLabel } from "../../utils/nodeLabel.js";
import { handleApiError } from "../../utils/handleApiError.js";
import type { GraphNode } from "@combat/shared";
import type { SupportNode, SupportTemplate, RelatedResult } from "../../api.js";

const { Text } = Typography;

interface SupportNodeWithChildren extends SupportNode {
  children: SupportNodeWithChildren[];
}

function buildTree(nodes: SupportNode[]) {
  const map = new Map<string, SupportNodeWithChildren>(nodes.map((n) => [n.id, { ...n, children: [] }]));
  const roots: SupportNodeWithChildren[] = [];
  for (const n of map.values()) {
    if (n.parentId && map.has(n.parentId)) map.get(n.parentId)!.children.push(n);
    else roots.push(n);
  }
  return roots.map(({ children, ...rest }) => ({
    ...rest,
    key: rest.id,
    title: rest.domain,
    children: children.map(({ children: c2, ...r2 }) => ({
      ...r2,
      key: r2.id,
      title: r2.domain,
      children: c2.map((c) => ({ key: c.id, title: c.domain, ...c })),
    })),
  }));
}

export interface AttackSupportNetworkTabProps {
  supportNodes: SupportNode[];
  supportLoading: boolean;
  templates: SupportTemplate[];
  selectedPersonName: string | null;
  selectedPerson: GraphNode | null;
  personRelated: RelatedResult | null;
  personPanelLoading: boolean;
  onOpenAdd: () => void;
  onOpenEdit: (nd: SupportNode) => void;
  onDeleteNode: (id: string) => Promise<void> | void;
  onSelectPerson: (name: string | null | undefined) => Promise<void> | void;
  onApplyTemplate: (templateId: string) => Promise<void> | void;
  refetchSupportNodes: () => Promise<void>;
}

export default function AttackSupportNetworkTab({
  supportNodes,
  supportLoading,
  templates,
  selectedPersonName,
  selectedPerson,
  personRelated,
  personPanelLoading,
  onOpenAdd,
  onOpenEdit,
  onDeleteNode,
  onSelectPerson,
  onApplyTemplate,
  refetchSupportNodes,
}: AttackSupportNetworkTabProps) {
  const navigate = useNavigate();
  const { guard } = useGuestGuard();
  const [tplModalOpen, setTplModalOpen] = useState(false);
  const [deletingTplId, setDeletingTplId] = useState<string | null>(null);

  const handleDeleteTemplate = async (id: string) => {
    if (!guard()) return;
    setDeletingTplId(id);
    try {
      await api.deleteSupportTemplate(id);
      message.success("模板已删除");
      await refetchSupportNodes();
    } catch (e) {
      handleApiError(e);
    } finally {
      setDeletingTplId(null);
    }
  };

  const tplColumns = [
    { title: "名称", dataIndex: "name", key: "name" },
    { title: "使用次数", dataIndex: "usageCount", key: "usageCount", width: 100 },
    {
      title: "操作",
      key: "ops",
      width: 80,
      render: (_: unknown, r: SupportTemplate) => (
        <Popconfirm title={`确认删除模板「${r.name}」？该操作不可恢复。`} onConfirm={() => handleDeleteTemplate(r.id)}>
          <a style={{ color: "#ff4d4f" }}>{deletingTplId === r.id ? <Spin size="small" /> : "删除"}</a>
        </Popconfirm>
      ),
    },
  ];

  return (
    <div style={{ padding: "16px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={onOpenAdd}>
            添加节点
          </Button>
          {templates.length > 0 && (
            <Select
              placeholder="应用模板"
              style={{ width: 160 }}
              allowClear
              onChange={(v) => v && onApplyTemplate(v)}
              options={templates.map((t) => ({ value: t.id, label: `${t.name} (${t.usageCount})` }))}
            />
          )}
          <Button icon={<SettingOutlined />} onClick={() => guard() && setTplModalOpen(true)}>
            管理模板
          </Button>
        </Space>
      </div>
      {supportLoading ? (
        <Spin />
      ) : supportNodes.length === 0 ? (
        <Empty description="暂无求助节点" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <Row gutter={16}>
          <Col span={14}>
            <Tree
              treeData={buildTree(supportNodes)}
              defaultExpandAll
              titleRender={(nd: any) => (
                <Space size={8}>
                  <Tooltip title={nd.note ? `备注：${nd.note}` : "无备注"}>
                    <Space size={8} style={{ cursor: "pointer" }} onClick={() => onSelectPerson(nd.personName)}>
                      <Tag color="blue">{nd.category}</Tag>
                      <Text
                        strong
                        style={
                          selectedPersonName && nd.personName === selectedPersonName ? { color: "#1677ff" } : undefined
                        }
                      >
                        {nd.personName || "待指定"}
                      </Text>
                      <Text type="secondary">· {nd.domain}</Text>
                      <Tag color={SUPPORT_STATUS_COLOR[nd.status] ?? "default"}>{nd.status}</Tag>
                    </Space>
                  </Tooltip>
                  <Button
                    size="small"
                    type="text"
                    icon={<EditOutlined />}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenEdit(nd);
                    }}
                  />
                  <Popconfirm title="确认删除该节点？" onConfirm={() => onDeleteNode(nd.id)}>
                    <Button
                      size="small"
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </Popconfirm>
                </Space>
              )}
            />
          </Col>
          <Col span={10}>
            <Card size="small" title="负责人详情" style={{ position: "sticky", top: 0 }}>
              {personPanelLoading ? (
                <Spin />
              ) : !selectedPersonName ? (
                <Empty description="点击左侧节点查看负责人详情与图谱关联" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : !selectedPerson ? (
                <Empty
                  description={`未在全员名单中找到「${selectedPersonName}」`}
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              ) : (
                <>
                  <Descriptions column={1} size="small" bordered>
                    <Descriptions.Item label="姓名">
                      {String(selectedPerson.properties["姓名"] ?? "-")}
                    </Descriptions.Item>
                    <Descriptions.Item label="部门">
                      {String(selectedPerson.properties["部门"] ?? "-")}
                    </Descriptions.Item>
                    <Descriptions.Item label="工号">
                      {String(selectedPerson.properties["工号"] ?? "-")}
                    </Descriptions.Item>
                    <Descriptions.Item label="邮箱">
                      {String(selectedPerson.properties["邮箱"] ?? "-")}
                    </Descriptions.Item>
                    <Descriptions.Item label="角色">
                      {String(selectedPerson.properties["角色"] ?? "-")}
                    </Descriptions.Item>
                  </Descriptions>
                  <Divider orientation="left" orientationMargin={0} style={{ marginTop: 12 }}>
                    知识图谱关联（一跳）
                  </Divider>
                  {(() => {
                    const items = [...(personRelated?.incoming ?? []), ...(personRelated?.outgoing ?? [])];
                    if (items.length === 0) return <Text type="secondary">暂无关联实体</Text>;
                    return (
                      <List
                        size="small"
                        dataSource={items}
                        renderItem={(it, i) => {
                          const p = it.node.properties;
                          const nm = String(p["标题"] ?? p["姓名"] ?? p["团队名称"] ?? p["name"] ?? nodeLabel(it.node));
                          return (
                            <List.Item key={`${it.node.id}-${i}`}>
                              <Space size={6} wrap>
                                <Tag color="geekblue">{it.field || it.concept || "关联"}</Tag>
                                <Tag>{NODE_TYPE_LABEL[it.node.nodeType] ?? it.node.nodeType}</Tag>
                                {it.node.nodeType === "attackTicket" ? (
                                  <a onClick={() => navigate(`/attack/${it.node.id}`)}>{nm}</a>
                                ) : (
                                  <Text>{nm}</Text>
                                )}
                              </Space>
                            </List.Item>
                          );
                        }}
                      />
                    );
                  })()}
                </>
              )}
            </Card>
          </Col>
        </Row>
      )}

      <Modal
        title="管理支撑模板"
        open={tplModalOpen}
        onCancel={() => setTplModalOpen(false)}
        footer={null}
        width={560}
        destroyOnClose
      >
        {templates.length === 0 ? (
          <Empty description="暂无模板" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Table rowKey="id" dataSource={templates} columns={tplColumns} size="small" pagination={false} />
        )}
      </Modal>
    </div>
  );
}
