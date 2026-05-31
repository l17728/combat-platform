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
// 攻关成员/成员列表 由专用多选 + 成员管理 tab 维护,不在通用 extraEditFields 中渲染
const HARDCODED_EDIT_FIELDS = new Set([
  "标题",
  "状态",
  "问题单号",
  "事件单号",
  "事件级别",
  "客户名称",
  "当前处理人",
  "攻关组长",
  "攻关成员",
  "成员列表",
  "攻关申请人",
  "影响及现存风险",
  "资源ID",
  "租户ID",
  "创建人",
  "私密",
  "私密授权人",
  "私密授权组",
]);
const SUMMARY_FIELD_IDS = new Set([
  "标题",
  "问题单号",
  "事件单号",
  "事件级别",
  "影响及现存风险",
  "客户名称",
  "故障发生时间",
  "当前处理人",
  "攻关组长",
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

  // ---- early returns ----
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
  if (data.initialLoading || !data.node) return <Spin size="large" style={{ display: "block", marginTop: 100 }} />;

  const {
    node,
    schema,
    progress,
    helpers,
    auditLogs,
    people,
    dailyReports,
    supportNodes,
    templates,
    dynamicTabs,
    emailGroups,
    drLoading,
    supportLoading,
  } = data;
  const props = node.properties;
  const status = String(props["状态"] ?? "");
  const isPrivate = String(props["私密"] ?? "") === "是";
  const isCreator = !!props["创建人"] && auth.user?.username === props["创建人"];
  const personOptions = people.map((p) => ({
    value: (p.properties["姓名"] as string) ?? "",
    label: `${p.properties["姓名"] ?? p.id} (${p.properties["部门"] ?? "-"})`,
  }));
  const basicFields = schema?.fields.filter((f) => !f.retired && !SUMMARY_FIELD_IDS.has(f.name)) ?? [];
  const seen = new Set<string>();
  const extraEditFields = (schema?.fields ?? []).filter((f) => {
    if (f.retired || HARDCODED_EDIT_FIELDS.has(f.name) || seen.has(f.name)) return false;
    seen.add(f.name);
    return true;
  });
  const keyAudits = filterKeyAudits(auditLogs);
  const SIDEBAR_CARD_OPTIONS = [
    { key: "helpers", label: "找帮手推荐" },
    ...(isLeader ? [{ key: "audit", label: "合规追溯" }] : []),
  ];

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
                        } catch (e: any) {
                          message.error("删除标签失败: " + e.message);
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
        extraEditFields={extraEditFields}
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
