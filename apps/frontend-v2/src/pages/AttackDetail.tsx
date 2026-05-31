import { useEffect, useState } from "react";
import { Typography, Button, Form, message, Spin, Row, Col, Tabs, Modal, Card } from "antd";
import { PlusOutlined, LockOutlined } from "@ant-design/icons";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, type TicketTab } from "../api.js";
import { parseMembers, type TeamRole } from "../utils/teamMembers.js";
import { filterKeyAudits } from "../utils/auditFilter.js";
import { useAuth } from "../hooks/useAuth.js";
import { useSettings } from "../hooks/useSettings.js";
import type { DailyReportEntry, SupportNode } from "../api.js";
import AttackDetailHeader from "./attackDetail/AttackDetailHeader.js";
import AttackDetailSidebar from "./attackDetail/AttackDetailSidebar.js";
import AttackDetailDrawers from "./attackDetail/AttackDetailDrawers.js";
import { useAttackDetailData } from "./attackDetail/useAttackDetailData.js";
import { useAttackDetailHandlers } from "./attackDetail/useAttackDetailHandlers.js";
import { buildAllTabItems } from "./attackDetail/buildTabItems.js";

const { Title, Text } = Typography;
const STATUS_STEPS = ["待响应", "处理中", "进行中", "已解决", "已关闭"];
// v2.6: schema-as-UI — 详情页基础信息 Tab 改为 schema 驱动分组渲染。
//
// 之前用 HARDCODED_EDIT_FIELDS / SUMMARY_FIELD_IDS 两个常量手动维护"哪些字段算基础/扩展",
// 现在改为从 FieldSchema 的 group / specialControl 中派生:
//   - basicFields  = schema.fields 全集(剔除 retired) → AttackBasicInfoTab 按 group 分 Card 渲染
//   - editableFields = schema.fields 剔除 specialControl='system'/'private-grants'/'private-flag'/'member-list'
//                     + 剔除 retired,自动按 group/order 排布
// 唯一保留的 specialControl 兜底:member-multi(攻关成员)在通用抽屉里也能多选改。
//
// 在 SchemaWizard 加新字段(并选好 group),AttackDetail 自动渲染,无需改任何前端代码。
const EXCLUDED_EDIT_SPECIAL = new Set([
  "system", // 创建人 / 时长 / 攻关单号 等系统字段
  "private-grants", // 私密授权人/组 由 「设置私密」 Drawer 管
  "private-flag", // 私密 由 「设置私密」/「取消私密」 按钮管
  "member-list", // 成员列表 由 「成员管理」 Tab 管
]);
const ROLE_OPTIONS_FALLBACK: TeamRole[] = ["组长", "组员"];

/**
 * AttackDetail 是「布局壳」:聚合数据(useAttackDetailData) + 处理交互(useAttackDetailHandlers)
 * + 6 个 tab 子组件 + 5 个 drawer/modal(集中在 AttackDetailDrawers)+ 侧边栏。
 *
 * 任何业务逻辑改动应该落到对应子组件 / hook,而不是本文件。
 */
export default function AttackDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // 场景 3:从 Hermes welink citation 跳转过来时,query 含 ?tab=welink&welinkMsg=<id>;
  // tab 受控切到 welink,WelinkTab 进而把 highlightMessageId 透传给 WelinkChatView 做滚动+黄背景高亮。
  const queryWelinkMsg = searchParams.get("welinkMsg") || undefined;
  const queryTab = searchParams.get("tab") || undefined;
  const [activeTabKey, setActiveTabKey] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (queryWelinkMsg || queryTab === "welink") setActiveTabKey("welink");
  }, [queryWelinkMsg, queryTab]);

  const data = useAttackDetailData(id);
  const auth = useAuth();
  const { isAdmin, isLeader } = auth;
  const { getValues } = useSettings();
  const STATUS_OPTIONS = getValues("状态", STATUS_STEPS);
  const SUPPORT_CATEGORIES = getValues("求助分类", ["环境", "领域专家", "团队协作", "资源"]);
  const SUPPORT_STATUSES = getValues("求助状态", ["待确认", "支持中", "已完成", "已撤销"]);
  const DR_TYPES = getValues("日报类型", ["进展通报", "风险通报"]);
  const ROLE_OPTIONS = getValues("团队角色", ROLE_OPTIONS_FALLBACK) as TeamRole[];

  // 基础信息字段隐藏偏好:按用户名持久化到 localStorage
  const basicFieldsKey = `attack-detail-hidden-basic-fields:${auth.user?.username || "guest"}`;
  const [hiddenBasicFields, setHiddenBasicFields] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(basicFieldsKey) || "[]");
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(basicFieldsKey, JSON.stringify(hiddenBasicFields));
    } catch {
      // 隐私模式 / 配额已满:静默忽略,本会话内行为仍正确
    }
  }, [hiddenBasicFields, basicFieldsKey]);
  // 面板默认收起,腾空间给主内容;用户主动勾选才显示卡;不持久化(每次进来都默认收起)
  const [visibleCards, setVisibleCards] = useState<string[]>([]);

  // ----- drawer/modal open state(纯 UI,不下放到 handlers hook 中)-----
  const [editOpen, setEditOpen] = useState(false);
  const [transitionOpen, setTransitionOpen] = useState(false);
  const [progressOpen, setProgressOpen] = useState(false);
  const [privacyDrawerOpen, setPrivacyDrawerOpen] = useState(false);
  const [memberDrawerOpen, setMemberDrawerOpen] = useState(false);
  const [editingMemberIdx, setEditingMemberIdx] = useState<number | null>(null);
  const [drModalOpen, setDrModalOpen] = useState(false);
  const [editingDr, setEditingDr] = useState<DailyReportEntry | null>(null);
  const [supportModalOpen, setSupportModalOpen] = useState(false);
  const [editingNode, setEditingNode] = useState<SupportNode | null>(null);
  const [addTabOpen, setAddTabOpen] = useState(false);

  // ----- forms -----
  const [editForm] = Form.useForm();
  const [transForm] = Form.useForm();
  const [progForm] = Form.useForm();
  const [drForm] = Form.useForm();
  const [supportForm] = Form.useForm();
  const [memberForm] = Form.useForm<{ 姓名: string; 角色: TeamRole }>();
  const [privacyForm] = Form.useForm<{ 授权人: string[]; 授权组: string[] }>();

  // ---- 派生值(允许 node=null,以便 hooks 全部固定调用顺序) ----
  const node = data.node;
  const propsObj = node?.properties ?? {};
  const status = String(propsObj["状态"] ?? "");
  const isPrivate = String(propsObj["私密"] ?? "") === "是";
  const people = data.people;

  // ---- hooks 必须无条件调用(React Hooks 规则) ----
  const h = useAttackDetailHandlers({
    id,
    node,
    people,
    isPrivate,
    status,
    refetch: data.refetch,
    refetchDailyReports: data.refetchDailyReports,
    refetchSupportNodes: data.refetchSupportNodes,
    editForm,
    transForm,
    progForm,
    drForm,
    supportForm,
    privacyForm,
    memberForm,
    onNavigateAfterDelete: () => navigate("/attack"),
    setEditOpen,
    setTransitionOpen,
    setProgressOpen,
    setPrivacyDrawerOpen,
    setMemberDrawerOpen,
    editingMemberIdx,
    setEditingMemberIdx,
    editingDr,
    setDrModalOpen,
    setEditingDr,
    editingNode,
    setSupportModalOpen,
    setEditingNode,
  });

  // ---- early returns(hooks 已全部调用,此处条件返回不违反 Hooks 规则) ----
  if (data.accessDenied) {
    return (
      <div style={{ padding: 80, textAlign: "center" }}>
        <LockOutlined style={{ fontSize: 48, color: "#fa8c16" }} />
        <Title level={4} style={{ marginTop: 16 }}>
          无权访问该攻关单
        </Title>
        <Text type="secondary">这是一个私密攻关单,仅创建人、成员及指定授权人/群组可见。</Text>
        <div style={{ marginTop: 24 }}>
          <Button onClick={() => navigate("/attack")}>返回列表</Button>
        </div>
      </div>
    );
  }
  if (data.initialLoading || !data.node || !node) {
    return <Spin size="large" style={{ display: "block", marginTop: 100 }} />;
  }

  // ---- 渲染期派生值(node 此时一定非空) ----
  const {
    schema,
    progress,
    helpers,
    auditLogs,
    dailyReports,
    supportNodes,
    templates,
    dynamicTabs,
    emailGroups,
    drLoading,
    supportLoading,
  } = data;
  const props = node.properties;
  const isCreator = !!props["创建人"] && auth.user?.username === props["创建人"];
  const personOptions = people.map((p) => ({
    value: (p.properties["姓名"] as string) ?? "",
    label: `${p.properties["姓名"] ?? p.id} (${p.properties["部门"] ?? "-"})`,
  }));
  // v2.6: schema-driven 字段渲染。
  // basicFields:基础信息 Tab 用 — 全部非 retired 字段(含系统字段在「系统字段」组里展示);
  // editableFields:编辑抽屉用 — 剔除 specialControl ∈ EXCLUDED_EDIT_SPECIAL 的字段。
  const basicFields = (schema?.fields ?? []).filter((f) => !f.retired);
  const seenEdit = new Set<string>();
  const editableFields = (schema?.fields ?? []).filter((f) => {
    if (f.retired) return false;
    if (f.specialControl && EXCLUDED_EDIT_SPECIAL.has(f.specialControl)) return false;
    if (seenEdit.has(f.name)) return false;
    seenEdit.add(f.name);
    return true;
  });
  const keyAudits = filterKeyAudits(auditLogs);
  const SIDEBAR_CARD_OPTIONS = [
    { key: "helpers", label: "找帮手推荐" },
    ...(isLeader ? [{ key: "audit", label: "合规追溯" }] : []),
  ];

  const allTabItems = buildAllTabItems({
    id: id!,
    isLeader,
    queryWelinkMsg,
    node,
    basicFields,
    hiddenBasicFields,
    setHiddenBasicFields,
    members: h.members,
    openAddMember: h.openAddMember,
    openEditMember: h.openEditMember,
    deleteMember: h.deleteMember,
    progress,
    auditLogs,
    setProgressOpen,
    dailyReports,
    drLoading,
    drForm,
    setEditingDr,
    setDrModalOpen,
    setDrDetail: h.setDrDetail,
    refetchDailyReports: data.refetchDailyReports,
    supportNodes,
    supportLoading,
    templates,
    selectedPersonName: h.selectedPersonName,
    selectedPerson: h.selectedPerson,
    personRelated: h.personRelated,
    personPanelLoading: h.personPanelLoading,
    supportForm,
    setSupportModalOpen,
    setEditingNode,
    handleDeleteSupportNode: h.handleDeleteSupportNode,
    selectSupportPerson: h.selectSupportPerson,
    handleApplyTemplate: h.handleApplyTemplate,
    dynamicTabs,
    setDynamicTabs: data.setDynamicTabs,
    onSchemaRefresh: () => {
      data.fetchSchema();
    },
    allFieldNames: schema?.fields?.map((f: any) => f.name) || [],
  });

  return (
    <div>
      <AttackDetailHeader
        node={node}
        schema={schema}
        id={id!}
        authUsername={auth.user?.username}
        isCreator={isCreator}
        isPrivate={isPrivate}
        visibleCards={visibleCards}
        sidebarCardOptions={SIDEBAR_CARD_OPTIONS}
        onVisibleCardsChange={setVisibleCards}
        onOpenPrivacyDrawer={h.openPrivacyDrawer}
        onCancelPrivacy={h.cancelPrivacy}
        onOpenTransition={() => setTransitionOpen(true)}
        onOpenEdit={() => {
          // 编辑抽屉里 攻关成员 是多选,需要把 成员列表 派生出组员姓名数组回填
          const onlyMembers = parseMembers(props)
            .filter((m) => m.角色 === "组员")
            .map((m) => m.姓名);
          editForm.setFieldsValue({ ...(props as any), 攻关成员: onlyMembers });
          setEditOpen(true);
        }}
        onDelete={h.handleDelete}
      />

      <Row gutter={16}>
        <Col span={visibleCards.length > 0 ? 18 : 24}>
          <Card styles={{ body: { padding: 0 } }}>
            <Tabs
              type="editable-card"
              hideAdd
              activeKey={activeTabKey}
              onChange={(k) => {
                setActiveTabKey(k);
                // 用户主动切走 welink tab → 清掉 welinkMsg query,避免再次激活高亮
                if (k !== "welink" && (queryWelinkMsg || queryTab === "welink")) {
                  const next = new URLSearchParams(searchParams);
                  next.delete("welinkMsg");
                  next.delete("tab");
                  setSearchParams(next, { replace: true });
                }
              }}
              style={{ padding: "0 16px" }}
              items={allTabItems}
              onEdit={(targetKey, action) => {
                if (action === "add") setAddTabOpen(true);
                if (action === "remove" && typeof targetKey === "string") {
                  const tab = dynamicTabs.find((t) => t.id === targetKey);
                  if (tab) {
                    Modal.confirm({
                      title: "删除标签",
                      content: "不再保存，确认后将永久删除此标签。",
                      okText: "确认删除",
                      okType: "danger",
                      cancelText: "取消",
                      onOk: async () => {
                        try {
                          await api.deleteTicketTab(id!, targetKey);
                          data.setDynamicTabs((prev) => prev.filter((t) => t.id !== targetKey));
                        } catch (e) {
                          message.error("删除标签失败: " + (e instanceof Error ? e.message : String(e)));
                        }
                      },
                    });
                  }
                }
              }}
              tabBarExtraContent={
                <Button size="small" icon={<PlusOutlined />} onClick={() => setAddTabOpen(true)}>
                  添加标签
                </Button>
              }
            />
          </Card>
        </Col>
        {visibleCards.length > 0 && (
          <Col span={6}>
            <AttackDetailSidebar
              ticketId={id!}
              visibleCards={visibleCards}
              helpers={helpers}
              keyAudits={keyAudits}
              isAdmin={isAdmin}
              isLeader={isLeader}
              onHide={(key) => setVisibleCards((prev) => prev.filter((k) => k !== key))}
            />
          </Col>
        )}
      </Row>

      <AttackDetailDrawers
        ticketId={id!}
        status={status}
        isPrivate={isPrivate}
        emailGroups={emailGroups}
        personOptions={personOptions}
        editableFields={editableFields}
        STATUS_OPTIONS={STATUS_OPTIONS}
        ROLE_OPTIONS={ROLE_OPTIONS}
        DR_TYPES={DR_TYPES}
        SUPPORT_CATEGORIES={SUPPORT_CATEGORIES}
        SUPPORT_STATUSES={SUPPORT_STATUSES}
        editForm={editForm}
        editOpen={editOpen}
        editSubmitting={h.editSubmitting}
        onEditClose={() => setEditOpen(false)}
        onEditSubmit={h.handleEdit}
        transForm={transForm}
        transitionOpen={transitionOpen}
        transSubmitting={h.transSubmitting}
        onTransitionClose={() => setTransitionOpen(false)}
        onTransitionSubmit={h.handleTransition}
        privacyForm={privacyForm}
        privacyDrawerOpen={privacyDrawerOpen}
        onPrivacyClose={() => setPrivacyDrawerOpen(false)}
        onPrivacySubmit={h.submitPrivacy}
        memberForm={memberForm}
        memberDrawerOpen={memberDrawerOpen}
        editingMemberIdx={editingMemberIdx}
        onMemberClose={() => setMemberDrawerOpen(false)}
        onMemberSubmit={h.submitMember}
        progForm={progForm}
        progressOpen={progressOpen}
        progSubmitting={h.progSubmitting}
        onProgressClose={() => setProgressOpen(false)}
        onProgressSubmit={h.handleAddProgress}
        drForm={drForm}
        drModalOpen={drModalOpen}
        drSubmitting={h.drSubmitting}
        editingDr={editingDr}
        onDrClose={() => {
          setDrModalOpen(false);
          setEditingDr(null);
        }}
        onDrSubmit={h.createDailyReport}
        drDetail={h.drDetail}
        onDrDetailClose={() => h.setDrDetail(null)}
        supportForm={supportForm}
        supportModalOpen={supportModalOpen}
        supportSubmitting={h.supportSubmitting}
        editingSupportNode={editingNode}
        supportNodes={supportNodes}
        onSupportClose={() => {
          setSupportModalOpen(false);
          setEditingNode(null);
        }}
        onSupportSubmit={h.handleSupportSubmit}
        addTabOpen={addTabOpen}
        onAddTabClose={() => setAddTabOpen(false)}
        onTabAdded={(newTab: TicketTab) => {
          data.setDynamicTabs((prev) => [...prev, newTab]);
          setAddTabOpen(false);
        }}
      />
    </div>
  );
}
