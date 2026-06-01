import { useEffect, useState, useCallback, useMemo } from "react";
import {
  Table,
  Button,
  Space,
  Select,
  Drawer,
  Form,
  Input,
  message,
  Popconfirm,
  Typography,
  Skeleton,
  Divider,
  Tooltip,
  Tag,
  Segmented,
} from "antd";
import { PlusOutlined, SearchOutlined, ExportOutlined, EditOutlined } from "@ant-design/icons";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { CONTRIBUTION_COLOR, PAGE_SIZE, PAGE_SIZE_OPTIONS } from "../constants.js";
import StatusTag from "../components/StatusTag.js";
import { useSettings } from "../hooks/useSettings.js";
import { useFlexTable, FlexHeaderCell } from "../hooks/useFlexTable.js";
import { useNodeSchema, editableFieldsOf } from "../hooks/useSchema.js";
import { SchemaFormBody } from "../components/SchemaField.js";
import type { GraphNode } from "@combat/shared";
import HelpButton from "../components/HelpButton.js";
import HELP from "../help-content.js";
import dayjs from "dayjs";
import { handleApiError } from "../utils/handleApiError.js";
import ContributionPivot from "./contributions/ContributionPivot.js";

const { Title } = Typography;

export default function Contributions() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // v2.3.5: 视图切换器(table / pivot);默认 table
  const [view, setView] = useState<"table" | "pivot">(() => (searchParams.get("view") === "pivot" ? "pivot" : "table"));
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (view !== "table") next.set("view", view);
    else next.delete("view");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
  const { getValues } = useSettings();
  // CONTRIB_LEVELS used for level filter; CONTRIB_TYPES used by Pivot view (form 内由 schema 驱动)
  const CONTRIB_LEVELS = getValues("贡献等级", ["核心", "关键", "普通"]);
  const CONTRIB_TYPES = getValues("贡献类型", ["问题定位", "代码实现", "测试验证", "文档", "协调"]);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [teamNodes, setTeamNodes] = useState<GraphNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [levelFilter, setLevelFilter] = useState<string | undefined>();
  const [searchText, setSearchText] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingNode, setEditingNode] = useState<GraphNode | null>(null);
  const [teamDrawerOpen, setTeamDrawerOpen] = useState(false);
  const [teamEditOpen, setTeamEditOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<GraphNode | null>(null);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const [teamForm] = Form.useForm();
  const [teamEditForm] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [teamSubmitting, setTeamSubmitting] = useState(false);
  const [teamEditSubmitting, setTeamEditSubmitting] = useState(false);
  const [people, setPeople] = useState<GraphNode[]>([]);
  const [tickets, setTickets] = useState<GraphNode[]>([]);
  // v2.3.5: 创建/编辑抽屉 schema 驱动 — 字段定义来自 contribution / teamContribution schema。
  const { schema: contribSchema } = useNodeSchema("contribution");
  const { schema: teamSchema } = useNodeSchema("teamContribution");
  const contribFields = editableFieldsOf(contribSchema);
  const teamFields = editableFieldsOf(teamSchema);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const filter: Record<string, string> = {};
      if (levelFilter) filter["贡献等级"] = levelFilter;
      const [list, teamList, ppl, tkt] = await Promise.all([
        api.listNodes("contribution", filter),
        api.listNodes("teamContribution").catch(() => []),
        api.listNodes("person").catch(() => []),
        api.listNodes("attackTicket").catch(() => []),
      ]);
      setNodes(list);
      setTeamNodes(teamList);
      setPeople(ppl);
      setTickets(tkt);
    } catch (e) {
      handleApiError(e);
    } finally {
      setLoading(false);
    }
  }, [levelFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filtered = searchText
    ? nodes.filter((n) => {
        const p = n.properties;
        const s = searchText.toLowerCase();
        return (p["贡献人"] as string)?.toLowerCase().includes(s) || (p["描述"] as string)?.toLowerCase().includes(s);
      })
    : nodes;

  const handleCreate = async (values: Record<string, unknown>) => {
    setSubmitting(true);
    try {
      await api.createNode("contribution", values);
      message.success("录入成功");
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

  const handleCreateTeam = async (values: Record<string, unknown>) => {
    setTeamSubmitting(true);
    try {
      await api.createNode("teamContribution", values);
      message.success("录入成功");
      setTeamDrawerOpen(false);
      teamForm.resetFields();
      fetchData();
    } catch (e) {
      handleApiError(e);
    } finally {
      setTeamSubmitting(false);
    }
  };

  const handleEditTeam = async (values: Record<string, unknown>) => {
    if (!editingTeam) return;
    setTeamEditSubmitting(true);
    try {
      await api.updateNode(editingTeam.id, values);
      message.success("更新成功");
      setTeamEditOpen(false);
      setEditingTeam(null);
      fetchData();
    } catch (e) {
      handleApiError(e);
    } finally {
      setTeamEditSubmitting(false);
    }
  };

  const handleDeleteTeam = async (id: string) => {
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
      const b = await api.exportNodes("contribution");
      const u = URL.createObjectURL(b);
      const a = document.createElement("a");
      a.href = u;
      a.download = `贡献记录_${dayjs().format("YYYYMMDD")}.xlsx`;
      a.click();
      URL.revokeObjectURL(u);
      message.success("导出成功");
    } catch (e) {
      handleApiError(e);
    }
  };

  const personSelectOptions = people.map((p) => ({
    value: (p.properties["姓名"] as string) ?? "",
    label: `${p.properties["姓名"] ?? p.id} (${p.properties["部门"] ?? "-"})`,
  }));

  const ticketSelectOptions = tickets.map((t) => ({
    value: (t.properties["标题"] as string) ?? t.id,
    label: `${t.properties["标题"] ?? "(无标题)"}${t.properties["问题单号"] ? ` · ${t.properties["问题单号"]}` : ""}`,
  }));
  // 给 schema 驱动的 ref 字段提供 refType→options 映射:关联攻关单字段是 string,
  // 但 attackTicket 这种 refType 我们仍把候选传进去,SchemaField 会按 string 走;
  // 真正用 refOptions 的是 person ref 字段(直接走 personOptions 参数)。
  const refOptions = { attackTicket: ticketSelectOptions, person: personSelectOptions };

  // v2.3.5: 关联攻关单是 string 类型而非 ref,需要单独的 Select override 才能拿到 ticketOptions
  const renderContribField = (f: import("@combat/shared").FieldSchema) => {
    if (f.name === "关联攻关单") {
      return (
        <Form.Item
          name={f.name}
          label={f.label}
          rules={f.required ? [{ required: true, message: `${f.label}必填` }] : []}
        >
          <Select
            showSearch
            allowClear
            placeholder="搜索攻关单"
            options={ticketSelectOptions}
            filterOption={(input, option) => (option?.label as string)?.toLowerCase().includes(input.toLowerCase())}
          />
        </Form.Item>
      );
    }
    return null;
  };

  const columns = [
    {
      key: "贡献人",
      title: "贡献人",
      dataIndex: ["properties", "贡献人"],
      width: 100,
      fixed: "left" as const,
      ellipsis: true,
      render: (v: string) => <a onClick={() => navigate(`/honor/${encodeURIComponent(v)}`)}>{v || "-"}</a>,
      sorter: (a: GraphNode, b: GraphNode) =>
        ((a.properties["贡献人"] as string) ?? "").localeCompare((b.properties["贡献人"] as string) ?? ""),
    },
    {
      key: "等级",
      title: "等级",
      dataIndex: ["properties", "贡献等级"],
      width: 80,
      render: (v: string) => <StatusTag status={v} type="contribution" />,
    },
    { key: "类型", title: "类型", dataIndex: ["properties", "贡献类型"], width: 80 },
    { key: "描述", title: "描述", dataIndex: ["properties", "描述"], ellipsis: true },
    {
      key: "关联攻关单",
      title: "关联攻关单",
      dataIndex: ["properties", "关联攻关单"],
      width: 140,
      ellipsis: true,
      render: (v: string) => {
        if (!v) return "--";
        const ticket = tickets.find((t) => t.properties["标题"] === v);
        if (ticket) return <a onClick={() => navigate(`/attack/${ticket.id}`)}>{v}</a>;
        return v;
      },
    },
    { key: "周期", title: "周期", dataIndex: ["properties", "周期"], width: 80 },
    {
      key: "时间",
      title: "时间",
      dataIndex: "createdAt",
      width: 80,
      render: (v: string) => <Tooltip title={dayjs(v).format("YYYY-MM-DD HH:mm")}>{dayjs(v).format("MM/DD")}</Tooltip>,
      sorter: (a: GraphNode, b: GraphNode) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      defaultSortOrder: "descend" as const,
    },
    {
      key: "操作",
      title: "操作",
      width: 100,
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
          <Popconfirm title="确认删除此贡献？" onConfirm={() => handleDelete(r.id)}>
            <a style={{ color: "#ff4d4f" }}>删除</a>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const { columns: flexCols, FlexWrapper } = useFlexTable("contribution", columns);
  const tableComponents = useMemo(() => ({ header: { cell: FlexHeaderCell } }), []);

  const teamColumns = [
    {
      key: "团队名称",
      title: "团队名称",
      dataIndex: ["properties", "团队名称"],
      width: 140,
      fixed: "left" as const,
      ellipsis: true,
      sorter: (a: GraphNode, b: GraphNode) =>
        ((a.properties["团队名称"] as string) ?? "").localeCompare((b.properties["团队名称"] as string) ?? ""),
    },
    {
      key: "等级",
      title: "等级",
      dataIndex: ["properties", "贡献等级"],
      width: 80,
      render: (v: string) => <StatusTag status={v} type="contribution" />,
    },
    { key: "类型", title: "类型", dataIndex: ["properties", "贡献类型"], width: 80 },
    { key: "组长", title: "组长", dataIndex: ["properties", "组长"], width: 100, ellipsis: true },
    {
      key: "组员",
      title: "组员",
      dataIndex: ["properties", "组员"],
      ellipsis: true,
      render: (v: unknown) => {
        const members = Array.isArray(v) ? (v as string[]) : [];
        if (members.length === 0) return "--";
        return (
          <div>
            {members.map((m) => (
              <Tag key={m} style={{ marginBottom: 2 }}>
                {m}
              </Tag>
            ))}
          </div>
        );
      },
    },
    {
      key: "关联攻关单",
      title: "关联攻关单",
      dataIndex: ["properties", "关联攻关单"],
      width: 140,
      ellipsis: true,
      render: (v: string) => {
        if (!v) return "--";
        const ticket = tickets.find((t) => t.properties["标题"] === v);
        if (ticket) return <a onClick={() => navigate(`/attack/${ticket.id}`)}>{v}</a>;
        return v;
      },
    },
    { key: "周期", title: "周期", dataIndex: ["properties", "周期"], width: 80 },
    {
      key: "时间",
      title: "时间",
      dataIndex: "createdAt",
      width: 90,
      render: (v: string) => <Tooltip title={dayjs(v).format("YYYY-MM-DD HH:mm")}>{dayjs(v).format("MM/DD")}</Tooltip>,
      sorter: (a: GraphNode, b: GraphNode) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      defaultSortOrder: "descend" as const,
    },
    {
      key: "操作",
      title: "操作",
      width: 100,
      fixed: "right" as const,
      render: (_: unknown, r: GraphNode) => (
        <Space>
          <a
            onClick={() => {
              setEditingTeam(r);
              teamEditForm.setFieldsValue(r.properties as any);
              setTeamEditOpen(true);
            }}
          >
            编辑
          </a>
          <Popconfirm title="确认删除此团队贡献？" onConfirm={() => handleDeleteTeam(r.id)}>
            <a style={{ color: "#ff4d4f" }}>删除</a>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const { columns: teamFlexCols, FlexWrapper: TeamFlexWrapper } = useFlexTable("teamContribution", teamColumns);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Title level={4} style={{ margin: 0 }}>
            贡献录入
          </Title>
          <HelpButton title={HELP.contributions.title} content={HELP.contributions.content} />
        </div>
        <Space>
          <Button icon={<PlusOutlined />} type="primary" onClick={() => setDrawerOpen(true)}>
            录入个人贡献
          </Button>
          <Button icon={<PlusOutlined />} onClick={() => setTeamDrawerOpen(true)}>
            录入团队贡献
          </Button>
          <Button icon={<ExportOutlined />} onClick={handleExport}>
            导出
          </Button>
        </Space>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <Space wrap>
          <Select
            placeholder="贡献等级"
            allowClear
            style={{ width: 120 }}
            value={levelFilter}
            onChange={setLevelFilter}
            options={CONTRIB_LEVELS.map((v) => ({ value: v, label: v }))}
          />
          <Input
            placeholder="搜索贡献人/描述"
            prefix={<SearchOutlined />}
            style={{ width: 220 }}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            allowClear
          />
        </Space>
        <Segmented
          data-testid="view-switcher"
          value={view}
          onChange={(v) => setView(v as "table" | "pivot")}
          options={[
            { label: "表格", value: "table" },
            { label: "透视", value: "pivot" },
          ]}
        />
      </div>

      {view === "pivot" ? (
        loading ? (
          <Skeleton active paragraph={{ rows: 6 }} />
        ) : (
          <ContributionPivot personNodes={filtered} teamNodes={teamNodes} contribTypes={CONTRIB_TYPES} />
        )
      ) : (
        <>
          <Divider orientation="left">个人贡献</Divider>
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

          <Divider orientation="left">团队贡献</Divider>
          {loading ? (
            <Skeleton active paragraph={{ rows: 4 }} />
          ) : (
            <TeamFlexWrapper>
              <Table
                rowKey="id"
                dataSource={teamNodes}
                columns={teamFlexCols}
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
            </TeamFlexWrapper>
          )}
        </>
      )}

      <Drawer
        title="录入个人贡献"
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
            提交
          </Button>
        }
      >
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          {/* v2.3.5: schema 驱动 — 字段定义来自 contribution schema (SchemaWizard 可改) */}
          <SchemaFormBody
            fields={contribFields}
            personOptions={personSelectOptions}
            refOptions={refOptions}
            renderField={renderContribField}
          />
        </Form>
      </Drawer>

      <Drawer
        title="编辑贡献"
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
          <SchemaFormBody
            fields={contribFields}
            personOptions={personSelectOptions}
            refOptions={refOptions}
            renderField={renderContribField}
          />
        </Form>
      </Drawer>

      <Drawer
        title="录入团队贡献"
        width={480}
        open={teamDrawerOpen}
        onClose={() => {
          setTeamDrawerOpen(false);
          teamForm.resetFields();
        }}
        destroyOnClose
        maskClosable={false}
        extra={
          <Button type="primary" loading={teamSubmitting} onClick={() => teamForm.submit()}>
            提交
          </Button>
        }
      >
        <Form form={teamForm} layout="vertical" onFinish={handleCreateTeam}>
          {/* v2.3.5: schema 驱动 — 组长(ref person)/ 组员(specialControl=member-multi) 由 SchemaField 自动渲染 */}
          <SchemaFormBody
            fields={teamFields}
            personOptions={personSelectOptions}
            refOptions={refOptions}
            renderField={renderContribField}
          />
        </Form>
      </Drawer>

      <Drawer
        title="编辑团队贡献"
        width={480}
        open={teamEditOpen}
        onClose={() => {
          setTeamEditOpen(false);
          setEditingTeam(null);
        }}
        destroyOnClose
        maskClosable={false}
        extra={
          <Button type="primary" loading={teamEditSubmitting} onClick={() => teamEditForm.submit()}>
            保存
          </Button>
        }
      >
        <Form form={teamEditForm} layout="vertical" onFinish={handleEditTeam}>
          <SchemaFormBody
            fields={teamFields}
            personOptions={personSelectOptions}
            refOptions={refOptions}
            renderField={renderContribField}
          />
        </Form>
      </Drawer>
    </div>
  );
}
