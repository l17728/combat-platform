import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Input, Button, Space, List, Modal, Form, message, Empty, Popconfirm, Typography, Tag, Tooltip } from "antd";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  SearchOutlined,
  BookOutlined,
  FileTextOutlined,
  HolderOutlined,
  LockOutlined,
  UnlockOutlined,
  LikeOutlined,
  LikeFilled,
  LeftOutlined,
  RightOutlined,
  ShareAltOutlined,
} from "@ant-design/icons";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import MarkdownRenderer from "./MarkdownRenderer.js";
import ShareModal from "./ShareModal.js";
import { api } from "../api.js";
import { handleApiError } from "../utils/handleApiError.js";
import { useAuth } from "../hooks/useAuth.js";

const { TextArea } = Input;
const { Title, Text } = Typography;

interface WikiArticle {
  id: string;
  scope: string;
  scope_id: string | null;
  parent_id: string | null;
  title: string;
  content: string;
  sort_order: number;
  created_by: string;
  is_locked: boolean;
  likes: number;
  liked: boolean;
  created_at: string;
  updated_at: string;
}

function tierOf(a: WikiArticle): "locked" | "liked" | "plain" {
  if (a.is_locked) return "locked";
  if (a.likes > 0) return "liked";
  return "plain";
}

const TIER_LABEL: Record<string, string> = { locked: "已加锁", liked: "已点赞", plain: "普通" };
const TIER_COLOR: Record<string, string> = { locked: "#cf1322", liked: "#1677ff", plain: "#8c8c8c" };

interface Props {
  scope: "global" | "ticket";
  scopeId?: string;
}

export default function WikiPanel({ scope, scopeId }: Props) {
  const { user, isAdmin } = useAuth();
  const username = user?.displayName || user?.username || "";
  const storageKey = `wiki-selected-${scope}${scopeId ? `-${scopeId}` : ""}`;
  const [articles, setArticles] = useState<WikiArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [selected, setSelected] = useState<WikiArticle | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editForm] = Form.useForm();
  const [createForm] = Form.useForm();
  const [editContent, setEditContent] = useState("");
  const [createContent, setCreateContent] = useState("");
  const [createLocked, setCreateLocked] = useState(false);
  const [editLocked, setEditLocked] = useState(false);
  const [deleteModal, setDeleteModal] = useState<{ id: string; title: string } | null>(null);
  const [deletePassword, setDeletePassword] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const editingIdRef = useRef<string | null>(null);

  const AVATAR_COLORS = ["#1677ff", "#52c41a", "#fa8c16", "#eb2f96", "#722ed1", "#13c2c2", "#cf1322", "#2f54eb"];

  function avatarColor(title: string): string {
    let hash = 0;
    for (let i = 0; i < title.length; i++) hash = title.charCodeAt(i) + ((hash << 5) - hash);
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
  }

  function avatarChar(title: string): string {
    return title.trim()[0] || "?";
  }
  const selectArticle = useCallback(
    (article: WikiArticle | null) => {
      setSelected(article);
      if (article) localStorage.setItem(storageKey, article.id);
    },
    [storageKey]
  );

  const fetchData = useCallback(
    async (silent?: boolean) => {
      if (!silent) setLoading(true);
      try {
        const result = keyword ? await api.searchWiki(scope, keyword, scopeId) : await api.listWiki(scope, scopeId);
        setArticles(result);
        const prevId = localStorage.getItem(storageKey);
        const target = prevId ? result.find((a: WikiArticle) => a.id === prevId) : null;
        if (target) {
          setSelected(target);
        } else if (result.length > 0) {
          setSelected(result[0]);
          localStorage.setItem(storageKey, result[0].id);
        } else {
          setSelected(null);
        }
      } catch (e) {
        handleApiError(e);
      } finally {
        setLoading(false);
      }
    },
    [scope, scopeId, keyword, storageKey]
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCreate = async () => {
    const values = createForm.getFieldsValue();
    const title = values.title?.trim();
    if (!title) {
      createForm.validateFields(["title"]).catch(() => {});
      return;
    }
    if (createLocked && !values.lockPassword?.trim()) {
      message.error("加锁时必须设置密码");
      return;
    }
    try {
      await api.createWiki({
        scope,
        scopeId,
        title,
        content: createContent,
        isLocked: createLocked,
        lockPassword: createLocked ? values.lockPassword : undefined,
      });
      message.success("创建成功");
      setCreateOpen(false);
      createForm.resetFields();
      setCreateContent("");
      setCreateLocked(false);
      fetchData(true);
    } catch (e) {
      handleApiError(e);
    }
  };

  const handleSave = async () => {
    const editId = editingIdRef.current;
    if (!editId) return;
    const values = editForm.getFieldsValue();
    const title = values.title?.trim();
    if (!title) {
      editForm.validateFields(["title"]).catch(() => {});
      return;
    }
    if (editLocked && !values.lockPassword?.trim()) {
      const original = articles.find((a) => a.id === editId);
      if (!original?.is_locked) {
        message.error("加锁时必须设置密码");
        return;
      }
    }
    try {
      await api.updateWiki(editId, {
        title,
        content: editContent,
        isLocked: editLocked,
        lockPassword: values.lockPassword || undefined,
      });
      message.success("保存成功");
      setEditOpen(false);
      editingIdRef.current = null;
      fetchData(true);
      const updated = await api.getWiki(editId);
      setSelected(updated);
    } catch (e) {
      handleApiError(e);
    }
  };

  const handleDelete = async (id: string, password?: string) => {
    const idx = articles.findIndex((a) => a.id === id);
    try {
      await api.deleteWiki(id, password);
      message.success("已删除");
      const remaining = articles.filter((a) => a.id !== id);
      setArticles(remaining);
      if (selected?.id === id) {
        const next = remaining[Math.min(idx, remaining.length - 1)] || null;
        setSelected(next);
        if (next) {
          localStorage.setItem(storageKey, next.id);
        } else {
          localStorage.removeItem(storageKey);
        }
      }
      fetchData(true);
    } catch (e) {
      handleApiError(e);
    }
  };

  const handleLike = async (id: string) => {
    try {
      const res = await api.likeWiki(id);
      setArticles((prev) => prev.map((a) => (a.id === id ? { ...a, likes: res.likes, liked: res.liked } : a)));
      if (selected?.id === id) {
        setSelected((prev) => (prev ? { ...prev, likes: res.likes, liked: res.liked } : prev));
      }
    } catch (e) {
      handleApiError(e);
    }
  };

  const openEdit = (article: WikiArticle) => {
    editingIdRef.current = article.id;
    editForm.setFieldsValue({ title: article.title, lockPassword: "" });
    setEditContent(article.content);
    setEditLocked(article.is_locked);
    setEditOpen(true);
  };

  const canDelete = (article: WikiArticle) => isAdmin || article.created_by === username;
  const canEdit = (article: WikiArticle) => !article.is_locked || isAdmin || article.created_by === username;

  const handleDeleteClick = (article: WikiArticle) => {
    if (!canDelete(article)) {
      message.error("仅创建者或管理员可删除此文章");
      return;
    }
    if (article.is_locked) {
      setDeleteModal({ id: article.id, title: article.title });
      setDeletePassword("");
    } else {
      handleDelete(article.id);
    }
  };

  const confirmDeleteLocked = () => {
    if (!deletePassword.trim()) {
      message.error("请输入密码");
      return;
    }
    handleDelete(deleteModal!.id, deletePassword);
    setDeleteModal(null);
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const canReorder = !keyword;

  // Group articles by tier for drag-within-tier
  const tieredIds = useMemo(() => {
    const locked = articles.filter((a) => tierOf(a) === "locked").map((a) => a.id);
    const liked = articles.filter((a) => tierOf(a) === "liked").map((a) => a.id);
    const plain = articles.filter((a) => tierOf(a) === "plain").map((a) => a.id);
    return { locked, liked, plain };
  }, [articles]);

  const tierForId = useCallback(
    (id: string) => {
      const a = articles.find((x) => x.id === id);
      return a ? tierOf(a) : null;
    },
    [articles]
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeTier = tierForId(String(active.id));
    const overTier = tierForId(String(over.id));
    if (activeTier !== overTier) return; // cross-tier drag blocked
    const tier = activeTier as string;
    const tierIds = tieredIds[tier as keyof typeof tieredIds];
    const oldIdx = tierIds.indexOf(String(active.id));
    const newIdx = tierIds.indexOf(String(over.id));
    if (oldIdx === -1 || newIdx === -1) return;
    const reordered = [...tierIds];
    const [moved] = reordered.splice(oldIdx, 1);
    reordered.splice(newIdx, 0, moved);
    try {
      await api.reorderWiki(reordered);
      fetchData(true);
    } catch (e) {
      handleApiError(e);
      fetchData(true);
    }
  };

  return (
    <div style={{ display: "flex", gap: collapsed ? 8 : 16, minHeight: 400 }}>
      {/* Left: article list / collapsed avatars */}
      <div
        style={{
          width: collapsed ? 48 : 300,
          flexShrink: 0,
          borderRight: "1px solid #f0f0f0",
          paddingRight: collapsed ? 4 : 16,
          transition: "width 0.2s",
          overflow: "hidden",
        }}
      >
        {collapsed ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, paddingTop: 8 }}>
            <Button
              type="text"
              size="small"
              icon={<RightOutlined />}
              onClick={() => setCollapsed(false)}
              style={{ marginBottom: 8 }}
            />
            <Tooltip title="新建" placement="right">
              <div
                onClick={() => setCreateOpen(true)}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  background: "#f0f0f0",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  color: "#999",
                  fontSize: 16,
                  marginBottom: 4,
                }}
              >
                <PlusOutlined />
              </div>
            </Tooltip>
            {articles.map((a) => (
              <Tooltip key={a.id} title={a.title} placement="right">
                <div
                  onClick={() => setSelected(a)}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: "50%",
                    background: selected?.id === a.id ? avatarColor(a.title) : avatarColor(a.title) + "33",
                    color: selected?.id === a.id ? "#fff" : avatarColor(a.title),
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: 600,
                    transition: "all 0.15s",
                    border: selected?.id === a.id ? `2px solid ${avatarColor(a.title)}` : "2px solid transparent",
                  }}
                >
                  {avatarChar(a.title)}
                </div>
              </Tooltip>
            ))}
          </div>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <Text strong style={{ fontSize: 14 }}>
                <BookOutlined /> 文章列表
              </Text>
              <Space size={4}>
                <Button size="small" icon={<LeftOutlined />} onClick={() => setCollapsed(true)} />
                <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
                  新建
                </Button>
              </Space>
            </div>
            <Input
              size="small"
              placeholder="搜索知识库..."
              prefix={<SearchOutlined />}
              allowClear
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              style={{ marginBottom: 12 }}
            />
            {canReorder ? (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={articles.map((a) => a.id)} strategy={verticalListSortingStrategy}>
                  <List
                    size="small"
                    loading={loading}
                    dataSource={articles}
                    locale={{ emptyText: <Empty description="暂无文章" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
                    renderItem={(item) => (
                      <SortableWikiItem
                        key={item.id}
                        item={item}
                        selected={selected?.id === item.id}
                        onSelect={() => setSelected(item)}
                        onEdit={() => openEdit(item)}
                        onDelete={() => handleDeleteClick(item)}
                        onLike={() => handleLike(item.id)}
                        canDelete={canDelete(item)}
                        canEdit={canEdit(item)}
                      />
                    )}
                  />
                </SortableContext>
              </DndContext>
            ) : (
              <List
                size="small"
                loading={loading}
                dataSource={articles}
                locale={{ emptyText: <Empty description="暂无文章" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
                renderItem={(item) => {
                  const tier = tierOf(item);
                  return (
                    <div
                      key={item.id}
                      onClick={() => setSelected(item)}
                      style={{
                        cursor: "pointer",
                        padding: "8px 12px",
                        borderRadius: 6,
                        background: selected?.id === item.id ? "#e6f4ff" : "transparent",
                        borderLeft: selected?.id === item.id ? "3px solid #1677ff" : "3px solid transparent",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <div style={{ flex: 1, overflow: "hidden", minWidth: 0 }}>
                        <Text ellipsis style={{ fontSize: 13 }}>
                          {item.title}
                        </Text>
                        <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                          {item.is_locked && (
                            <Tag
                              color="red"
                              icon={<LockOutlined />}
                              style={{ fontSize: 10, lineHeight: "16px", padding: "0 4px", margin: 0 }}
                            >
                              已锁
                            </Tag>
                          )}
                          <Tag
                            color={TIER_COLOR[tier]}
                            style={{ fontSize: 10, lineHeight: "16px", padding: "0 4px", margin: 0 }}
                          >
                            {TIER_LABEL[tier]}
                          </Tag>
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            {item.created_by || "系统"} · {new Date(item.updated_at).toLocaleDateString()}
                          </Text>
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 0, flexShrink: 0 }}>
                        <Tooltip title={item.liked ? "取消点赞" : "点赞"}>
                          <Button
                            type="text"
                            size="small"
                            icon={item.liked ? <LikeFilled style={{ color: "#1677ff" }} /> : <LikeOutlined />}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleLike(item.id);
                            }}
                          >
                            {item.likes > 0 ? item.likes : ""}
                          </Button>
                        </Tooltip>
                        {canEdit(item) && (
                          <Button
                            type="text"
                            size="small"
                            icon={<EditOutlined />}
                            onClick={(e) => {
                              e.stopPropagation();
                              openEdit(item);
                            }}
                          />
                        )}
                        <Button
                          type="text"
                          size="small"
                          danger
                          icon={<DeleteOutlined />}
                          disabled={!canDelete(item)}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteClick(item);
                          }}
                        />
                      </div>
                    </div>
                  );
                }}
              />
            )}
          </>
        )}
      </div>

      {/* Right: content view */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {selected ? (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Title level={4} style={{ margin: 0 }}>
                    {selected.title}
                  </Title>
                  {selected.is_locked && (
                    <Tag color="red" icon={<LockOutlined />}>
                      已加锁
                    </Tag>
                  )}
                  <Tag color={TIER_COLOR[tierOf(selected)]}>{TIER_LABEL[tierOf(selected)]}</Tag>
                </div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {selected.created_by || "系统"} · 创建于 {new Date(selected.created_at).toLocaleString()} · 更新于{" "}
                  {new Date(selected.updated_at).toLocaleString()}
                </Text>
              </div>
              <Space>
                <Tooltip title={selected.liked ? "取消点赞" : "点赞"}>
                  <Button
                    icon={selected.liked ? <LikeFilled style={{ color: "#1677ff" }} /> : <LikeOutlined />}
                    onClick={() => handleLike(selected.id)}
                  >
                    {selected.likes > 0 ? `${selected.likes} 赞` : "点赞"}
                  </Button>
                </Tooltip>
                {!selected.is_locked && (
                  <Button icon={<ShareAltOutlined />} onClick={() => setShareOpen(true)}>
                    分享
                  </Button>
                )}
                {(!selected.is_locked || canEdit(selected)) && (
                  <Button icon={<EditOutlined />} onClick={() => openEdit(selected)}>
                    编辑
                  </Button>
                )}
                {canDelete(selected) ? (
                  <Popconfirm
                    title={selected.is_locked ? "此文章已加锁，删除需要输入密码" : "确认删除此文章？"}
                    onConfirm={() => handleDeleteClick(selected)}
                  >
                    <Button danger icon={<DeleteOutlined />}>
                      删除
                    </Button>
                  </Popconfirm>
                ) : (
                  <Tooltip title="仅创建者或管理员可删除">
                    <Button danger icon={<DeleteOutlined />} disabled>
                      删除
                    </Button>
                  </Tooltip>
                )}
              </Space>
            </div>
            <div
              className="markdown-body"
              style={{
                padding: 16,
                border: "1px solid #f0f0f0",
                borderRadius: 8,
                background: "#fafafa",
                minHeight: 200,
              }}
            >
              <MarkdownRenderer>{selected.content || "*暂无内容*"}</MarkdownRenderer>
            </div>
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              opacity: 0.5,
            }}
          >
            <FileTextOutlined style={{ fontSize: 48, marginBottom: 16 }} />
            <Text type="secondary">选择左侧文章查看内容，或点击「新建」创建知识库文章</Text>
          </div>
        )}
      </div>

      {/* Create Modal */}
      <Modal
        title="新建知识库文章"
        open={createOpen}
        onCancel={() => {
          setCreateOpen(false);
          createForm.resetFields();
          setCreateContent("");
          setCreateLocked(false);
        }}
        onOk={handleCreate}
        okText="创建"
        width={600}
        forceRender
      >
        <Form form={createForm} layout="vertical">
          <Form.Item name="title" label="标题" rules={[{ required: true, message: "请输入标题" }]}>
            <Input placeholder="输入文章标题" />
          </Form.Item>
          <div style={{ marginBottom: 16 }}>
            <Space>
              <Button
                size="small"
                type={createLocked ? "primary" : "default"}
                danger={createLocked}
                icon={createLocked ? <LockOutlined /> : <UnlockOutlined />}
                onClick={() => setCreateLocked(!createLocked)}
              >
                {createLocked ? "已加锁" : "加锁"}
              </Button>
              {createLocked && (
                <Form.Item name="lockPassword" noStyle rules={[{ required: createLocked, message: "请输入密码" }]}>
                  <Input.Password placeholder="设置加锁密码" size="small" style={{ width: 200 }} />
                </Form.Item>
              )}
            </Space>
          </div>
        </Form>
        <div style={{ marginBottom: 8 }}>
          <Text type="secondary">正文（支持 Markdown）</Text>
        </div>
        <TextArea
          value={createContent}
          onChange={(e) => setCreateContent(e.target.value)}
          placeholder="输入 Markdown 内容..."
          autoSize={{ minRows: 8, maxRows: 20 }}
          style={{ fontFamily: "monospace" }}
        />
      </Modal>

      {/* Edit Modal */}
      <Modal
        title="编辑文章"
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={handleSave}
        okText="保存"
        width={600}
        forceRender
      >
        <Form form={editForm} layout="vertical">
          <Form.Item name="title" label="标题" rules={[{ required: true, message: "请输入标题" }]}>
            <Input placeholder="输入文章标题" />
          </Form.Item>
          <div style={{ marginBottom: 16 }}>
            <Space>
              <Button
                size="small"
                type={editLocked ? "primary" : "default"}
                danger={editLocked}
                icon={editLocked ? <LockOutlined /> : <UnlockOutlined />}
                onClick={() => setEditLocked(!editLocked)}
              >
                {editLocked ? "已加锁" : "加锁"}
              </Button>
              {editLocked && (
                <Form.Item name="lockPassword" noStyle>
                  <Input.Password
                    placeholder={selected?.is_locked ? "留空保持原密码，或输入新密码" : "设置加锁密码"}
                    size="small"
                    style={{ width: 260 }}
                  />
                </Form.Item>
              )}
            </Space>
          </div>
        </Form>
        <div style={{ marginBottom: 8 }}>
          <Text type="secondary">正文（支持 Markdown）</Text>
        </div>
        <TextArea
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
          autoSize={{ minRows: 8, maxRows: 20 }}
          style={{ fontFamily: "monospace" }}
        />
      </Modal>

      {/* Delete Locked Article Password Modal */}
      <Modal
        title={`删除加锁文章「${deleteModal?.title ?? ""}」`}
        open={!!deleteModal}
        onCancel={() => setDeleteModal(null)}
        onOk={confirmDeleteLocked}
        okText="确认删除"
        okButtonProps={{ danger: true }}
      >
        <Text>此文章已加锁，请输入密码以确认删除：</Text>
        <Input.Password
          value={deletePassword}
          onChange={(e) => setDeletePassword(e.target.value)}
          placeholder="输入加锁密码"
          style={{ marginTop: 12 }}
          onPressEnter={confirmDeleteLocked}
        />
      </Modal>

      {selected && (
        <ShareModal
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          entityType="wiki"
          entityId={selected.id}
          entityTitle={selected.title}
        />
      )}
    </div>
  );
}

function SortableWikiItem({
  item,
  selected,
  onSelect,
  onEdit,
  onDelete,
  onLike,
  canDelete,
  canEdit,
}: {
  item: WikiArticle;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onLike: () => void;
  canDelete: boolean;
  canEdit: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    cursor: "pointer",
    padding: "8px 12px",
    borderRadius: 6,
    background: selected ? "#e6f4ff" : "transparent",
    borderLeft: selected ? "3px solid #1677ff" : "3px solid transparent",
    opacity: isDragging ? 0.5 : 1,
  };
  const tier = tierOf(item);
  return (
    <div ref={setNodeRef} style={style} {...attributes} onClick={onSelect}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, width: "100%" }}>
        <span
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          style={{ cursor: "grab", color: "#999", fontSize: 12, flexShrink: 0 }}
        >
          <HolderOutlined />
        </span>
        <div style={{ flex: 1, overflow: "hidden", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <Text ellipsis style={{ fontSize: 13 }}>
              {item.title}
            </Text>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
            {item.is_locked && (
              <Tag
                color="red"
                icon={<LockOutlined />}
                style={{ fontSize: 10, lineHeight: "16px", padding: "0 4px", margin: 0 }}
              >
                已锁
              </Tag>
            )}
            <Tag color={TIER_COLOR[tier]} style={{ fontSize: 10, lineHeight: "16px", padding: "0 4px", margin: 0 }}>
              {TIER_LABEL[tier]}
            </Tag>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {item.created_by || "系统"} · {new Date(item.updated_at).toLocaleDateString()}
            </Text>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 0, flexShrink: 0 }}>
          <Tooltip title={item.liked ? "取消点赞" : "点赞"}>
            <Button
              type="text"
              size="small"
              icon={item.liked ? <LikeFilled style={{ color: "#1677ff" }} /> : <LikeOutlined />}
              onClick={(e) => {
                e.stopPropagation();
                onLike();
              }}
            >
              {item.likes > 0 ? item.likes : ""}
            </Button>
          </Tooltip>
          {canEdit && (
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
            />
          )}
          <Button
            type="text"
            size="small"
            danger
            icon={<DeleteOutlined />}
            disabled={!canDelete}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          />
        </div>
      </div>
    </div>
  );
}
