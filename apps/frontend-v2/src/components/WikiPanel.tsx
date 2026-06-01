import { useState, useEffect, useCallback } from "react";
import {
  Input,
  Button,
  Space,
  List,
  Modal,
  Form,
  message,
  Empty,
  Popconfirm,
  Typography,
  Card,
  Breadcrumb,
} from "antd";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  SearchOutlined,
  BookOutlined,
  FolderOutlined,
  FileTextOutlined,
  ArrowLeftOutlined,
} from "@ant-design/icons";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../api.js";
import { handleApiError } from "../utils/handleApiError.js";

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
  created_at: string;
  updated_at: string;
}

interface Props {
  scope: "global" | "ticket";
  scopeId?: string;
}

export default function WikiPanel({ scope, scopeId }: Props) {
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

  const fetchData = useCallback(
    async (silent?: boolean) => {
      if (!silent) setLoading(true);
      try {
        if (keyword) {
          const result = await api.searchWiki(scope, keyword, scopeId);
          setArticles(result);
        } else {
          const result = await api.listWiki(scope, scopeId);
          setArticles(result);
        }
      } catch (e) {
        handleApiError(e);
      } finally {
        setLoading(false);
      }
    },
    [scope, scopeId, keyword]
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCreate = async () => {
    const title = createForm.getFieldValue("title")?.trim();
    if (!title) {
      createForm.validateFields(["title"]).catch(() => {});
      return;
    }
    try {
      await api.createWiki({ scope, scopeId, title, content: createContent });
      message.success("创建成功");
      setCreateOpen(false);
      createForm.resetFields();
      setCreateContent("");
      fetchData(true);
    } catch (e) {
      handleApiError(e);
    }
  };

  const handleSave = async () => {
    if (!selected) return;
    const title = editForm.getFieldValue("title")?.trim();
    if (!title) {
      editForm.validateFields(["title"]).catch(() => {});
      return;
    }
    try {
      await api.updateWiki(selected.id, { title, content: editContent });
      message.success("保存成功");
      setEditOpen(false);
      fetchData(true);
      const updated = await api.getWiki(selected.id);
      setSelected(updated);
    } catch (e) {
      handleApiError(e);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteWiki(id);
      message.success("已删除");
      if (selected?.id === id) setSelected(null);
      fetchData(true);
    } catch (e) {
      handleApiError(e);
    }
  };

  const openEdit = (article: WikiArticle) => {
    editForm.setFieldsValue({ title: article.title });
    setEditContent(article.content);
    setEditOpen(true);
  };

  return (
    <div style={{ display: "flex", gap: 16, minHeight: 400 }}>
      {/* Left: article list */}
      <div style={{ width: 280, flexShrink: 0, borderRight: "1px solid #f0f0f0", paddingRight: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <Text strong style={{ fontSize: 14 }}>
            <BookOutlined /> 文章列表
          </Text>
          <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            新建
          </Button>
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
        <List
          size="small"
          loading={loading}
          dataSource={articles}
          locale={{ emptyText: <Empty description="暂无文章" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
          renderItem={(item) => (
            <List.Item
              key={item.id}
              onClick={() => setSelected(item)}
              style={{
                cursor: "pointer",
                padding: "8px 12px",
                borderRadius: 6,
                background: selected?.id === item.id ? "#e6f4ff" : "transparent",
                borderLeft: selected?.id === item.id ? "3px solid #1677ff" : "3px solid transparent",
              }}
              actions={[
                <Button
                  key="edit"
                  type="text"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={(e) => {
                    e.stopPropagation();
                    openEdit(item);
                  }}
                />,
                <Popconfirm
                  key="del"
                  title="确认删除此文章？"
                  onConfirm={(e) => {
                    e?.stopPropagation();
                    handleDelete(item.id);
                  }}
                >
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={(e) => e.stopPropagation()}
                  />
                </Popconfirm>,
              ]}
            >
              <div style={{ overflow: "hidden" }}>
                <Text ellipsis style={{ fontSize: 13, maxWidth: 140 }}>
                  {item.title}
                </Text>
                <div>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {item.created_by || "系统"} · {new Date(item.updated_at).toLocaleDateString()}
                  </Text>
                </div>
              </div>
            </List.Item>
          )}
        />
      </div>

      {/* Right: content view */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {selected ? (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div>
                <Title level={4} style={{ margin: 0 }}>
                  {selected.title}
                </Title>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {selected.created_by || "系统"} · 创建于 {new Date(selected.created_at).toLocaleString()} · 更新于{" "}
                  {new Date(selected.updated_at).toLocaleString()}
                </Text>
              </div>
              <Space>
                <Button icon={<EditOutlined />} onClick={() => openEdit(selected)}>
                  编辑
                </Button>
                <Popconfirm title="确认删除此文章？" onConfirm={() => handleDelete(selected.id)}>
                  <Button danger icon={<DeleteOutlined />}>
                    删除
                  </Button>
                </Popconfirm>
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
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{selected.content || "*暂无内容*"}</ReactMarkdown>
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
    </div>
  );
}
