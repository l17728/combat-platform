import { useEffect, useState, useCallback, useMemo } from "react";
import {
  Table,
  Button,
  Space,
  Input,
  Select,
  Drawer,
  Form,
  message,
  Popconfirm,
  Typography,
  Skeleton,
  Descriptions,
  Upload,
} from "antd";
import {
  PlusOutlined,
  UploadOutlined,
  ExportOutlined,
  SearchOutlined,
  EditOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { PAGE_SIZE, PAGE_SIZE_OPTIONS, DATE_FORMAT } from "../constants.js";
import { useFlexTable, FlexHeaderCell } from "../hooks/useFlexTable.js";
import { useNodeSchema, editableFieldsOf, viewFieldsOf } from "../hooks/useSchema.js";
import { SchemaFormBody, SchemaViewBody } from "../components/SchemaField.js";
import type { GraphNode } from "@combat/shared";
import HelpButton from "../components/HelpButton.js";
import HELP from "../help-content.js";
import dayjs from "dayjs";
import { handleApiError } from "../utils/handleApiError.js";

const { Title, Text } = Typography;

export default function PeopleList() {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [deptFilter, setDeptFilter] = useState<string | undefined>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailNode, setDetailNode] = useState<GraphNode | null>(null);
  const [editingNode, setEditingNode] = useState<GraphNode | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const navigate = useNavigate();
  // v2.3.5: schema 驱动 — 表单字段由 person schema 派生,在 SchemaWizard 加字段即生效。
  const { schema: personSchema } = useNodeSchema("person");
  const editableFields = editableFieldsOf(personSchema);
  const viewFields = viewFieldsOf(personSchema);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      setNodes(await api.listNodes("person"));
    } catch (e) {
      handleApiError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const departments = [...new Set(nodes.map((n) => n.properties["部门"] as string).filter(Boolean))];

  const filtered = nodes.filter((n) => {
    const p = n.properties;
    if (deptFilter && p["部门"] !== deptFilter) return false;
    if (searchText) {
      const s = searchText.toLowerCase();
      return (
        (p["姓名"] as string)?.toLowerCase().includes(s) ||
        (p["邮箱"] as string)?.toLowerCase().includes(s) ||
        (p["工号"] as string)?.toLowerCase().includes(s)
      );
    }
    return true;
  });

  const handleCreate = async (values: Record<string, unknown>) => {
    setSubmitting(true);
    try {
      await api.createNode("person", values);
      message.success("添加成功");
      setDrawerOpen(false);
      form.resetFields();
      fetchData();
    } catch (e) {
      handleApiError(e);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = async (values: Record<string, unknown>) => {
    if (!editingNode) return;
    setEditSubmitting(true);
    try {
      await api.updateNode(editingNode.id, values);
      message.success("更新成功");
      setEditOpen(false);
      setEditingNode(null);
      fetchData();
    } catch (e) {
      handleApiError(e);
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteNode(id);
      message.success("删除成功");
      fetchData();
    } catch (e) {
      handleApiError(e);
    }
  };

  const handleExport = async () => {
    try {
      const blob = await api.exportNodes("person");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `全员名单_${dayjs().format("YYYYMMDD")}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      message.success("导出成功");
    } catch (e) {
      handleApiError(e);
    }
  };

  const handleImport = async (file: File) => {
    try {
      const result = await api.importXlsx(file, "person");
      message.success(`导入完成：新增 ${result.created}，更新 ${result.updated}`);
      setImportOpen(false);
      fetchData();
    } catch (e) {
      handleApiError(e);
    }
  };

  const columns = [
    {
      key: "姓名",
      title: "姓名",
      dataIndex: ["properties", "姓名"],
      width: 100,
      fixed: "left" as const,
      render: (v: string, r: GraphNode) => (
        <a
          onClick={() => {
            setDetailNode(r);
            setDetailOpen(true);
          }}
        >
          {v || "-"}
        </a>
      ),
      sorter: (a: GraphNode, b: GraphNode) =>
        ((a.properties["姓名"] as string) ?? "").localeCompare((b.properties["姓名"] as string) ?? ""),
    },
    { key: "工号", title: "工号", dataIndex: ["properties", "工号"], width: 110, ellipsis: true },
    { key: "邮箱", title: "邮箱", dataIndex: ["properties", "邮箱"], width: 220, ellipsis: true },
    {
      key: "部门",
      title: "部门",
      dataIndex: ["properties", "部门"],
      width: 140,
      ellipsis: true,
      sorter: (a: GraphNode, b: GraphNode) =>
        ((a.properties["部门"] as string) ?? "").localeCompare((b.properties["部门"] as string) ?? ""),
    },
    { key: "角色", title: "角色", dataIndex: ["properties", "角色"], width: 100, ellipsis: true },
    {
      key: "操作",
      title: "操作",
      width: 120,
      fixed: "right" as const,
      render: (_: unknown, r: GraphNode) => (
        <Space>
          <a
            onClick={() => {
              setEditingNode(r);
              editForm.setFieldsValue(r.properties as any);
              setEditOpen(true);
            }}
          >
            编辑
          </a>
          <a onClick={() => navigate(`/honor/${encodeURIComponent(String(r.properties["姓名"] ?? r.id))}`)}>荣誉</a>
          <Popconfirm title={`确认删除「${r.properties["姓名"] ?? ""}」？`} onConfirm={() => handleDelete(r.id)}>
            <a style={{ color: "#ff4d4f" }}>删除</a>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const { columns: flexCols, FlexWrapper } = useFlexTable("person", columns);
  const tableComponents = useMemo(() => ({ header: { cell: FlexHeaderCell } }), []);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Title level={4} style={{ margin: 0 }}>
            全员名单
          </Title>
          <HelpButton title={HELP.peopleList.title} content={HELP.peopleList.content} />
        </div>
        <Space>
          <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>
            导入名单
          </Button>
          <Button icon={<ExportOutlined />} onClick={handleExport}>
            导出
          </Button>
          <Button icon={<PlusOutlined />} type="primary" onClick={() => setDrawerOpen(true)}>
            添加
          </Button>
        </Space>
      </div>

      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          placeholder="部门筛选"
          allowClear
          style={{ width: 140 }}
          value={deptFilter}
          onChange={setDeptFilter}
          options={departments.map((d) => ({ value: d, label: d }))}
        />
        <Input
          placeholder="搜索姓名/邮箱/工号"
          prefix={<SearchOutlined />}
          style={{ width: 240 }}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          allowClear
        />
      </Space>

      {loading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : (
        <FlexWrapper>
          <Table
            rowKey="id"
            dataSource={filtered}
            columns={flexCols}
            components={tableComponents}
            scroll={{ x: true }}
            pagination={{
              pageSize: PAGE_SIZE,
              showSizeChanger: true,
              pageSizeOptions: PAGE_SIZE_OPTIONS,
              showTotal: (t) => `共 ${t} 条`,
            }}
            size="middle"
          />
        </FlexWrapper>
      )}

      <Drawer
        title="添加人员"
        width={480}
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          form.resetFields();
        }}
        destroyOnClose
        maskClosable={false}
        extra={
          <Button type="primary" loading={submitting} onClick={() => form.submit()}>
            添加
          </Button>
        }
      >
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          <SchemaFormBody fields={editableFields} />
        </Form>
      </Drawer>

      <Drawer
        title="编辑人员"
        width={480}
        open={editOpen}
        onClose={() => {
          setEditOpen(false);
          setEditingNode(null);
        }}
        destroyOnClose
        maskClosable={false}
        extra={
          <Button type="primary" loading={editSubmitting} onClick={() => editForm.submit()}>
            保存
          </Button>
        }
      >
        <Form form={editForm} layout="vertical" onFinish={handleEdit}>
          <SchemaFormBody fields={editableFields} />
        </Form>
      </Drawer>

      <Drawer
        title="人员详情"
        width={560}
        open={detailOpen}
        onClose={() => {
          setDetailOpen(false);
          setDetailNode(null);
        }}
        destroyOnClose
        extra={
          <Space>
            <Button
              icon={<EditOutlined />}
              onClick={() => {
                if (!detailNode) return;
                setDetailOpen(false);
                setEditingNode(detailNode);
                editForm.setFieldsValue(detailNode.properties as any);
                setEditOpen(true);
              }}
            >
              编辑
            </Button>
            <Button
              type="primary"
              onClick={() => {
                if (!detailNode) return;
                navigate(`/honor/${encodeURIComponent(String(detailNode.properties["姓名"] ?? detailNode.id))}`);
              }}
            >
              查看荣誉
            </Button>
          </Space>
        }
      >
        {detailNode && (
          <div>
            <div style={{ textAlign: "center", marginBottom: 24 }}>
              <div
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: "50%",
                  background: "#f0f5ff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  margin: "0 auto 12px",
                }}
              >
                <UserOutlined style={{ fontSize: 28, color: "#0050b3" }} />
              </div>
              <Title level={4} style={{ margin: 0 }}>
                {String(detailNode.properties["姓名"] ?? "-")}
              </Title>
              <Text type="secondary">
                {String(detailNode.properties["部门"] ?? "")}
                {detailNode.properties["部门"] && detailNode.properties["角色"] ? " · " : ""}
                {String(detailNode.properties["角色"] ?? "")}
              </Text>
            </div>
            {/* v2.3.5: schema 驱动 — 字段按 person schema 的 group/order 分组渲染 */}
            <SchemaViewBody
              fields={viewFields.filter((f) => f.name !== "姓名")}
              values={detailNode.properties}
              column={1}
            />
            <Descriptions bordered column={1} size="small" title="时间">
              <Descriptions.Item label="创建时间">{dayjs(detailNode.createdAt).format(DATE_FORMAT)}</Descriptions.Item>
              <Descriptions.Item label="更新时间">{dayjs(detailNode.updatedAt).format(DATE_FORMAT)}</Descriptions.Item>
            </Descriptions>
          </div>
        )}
      </Drawer>

      <Drawer
        title="导入全员名单"
        width={480}
        open={importOpen}
        onClose={() => setImportOpen(false)}
        destroyOnClose
        maskClosable={false}
      >
        <div style={{ marginBottom: 16 }}>
          <Button onClick={handleExport} size="small">
            下载模板
          </Button>
        </div>
        <Upload.Dragger
          accept=".xlsx,.xls"
          showUploadList={false}
          customRequest={({ file }) => handleImport(file as File)}
        >
          <p className="ant-upload-text">点击或拖拽 Excel 文件到此处</p>
          <p className="ant-upload-hint">支持 .xlsx / .xls 格式</p>
        </Upload.Dragger>
      </Drawer>
    </div>
  );
}
