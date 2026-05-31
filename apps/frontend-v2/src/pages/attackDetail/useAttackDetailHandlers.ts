import { useState } from "react";
import { message } from "antd";
import type { FormInstance } from "antd";
import { api } from "../../api.js";
import {
  parseMembers,
  syncMemberFields,
  buildMembersFromForm,
  type TeamMember,
  type TeamRole,
} from "../../utils/teamMembers.js";
import type { GraphNode } from "@combat/shared";
import type { DailyReportEntry, RelatedResult, SupportNode } from "../../api.js";
import { handleApiError } from "../../utils/handleApiError.js";

interface UseAttackDetailHandlersArgs {
  id: string | undefined;
  node: GraphNode | null;
  people: GraphNode[];
  isPrivate: boolean;
  status: string;
  refetch: () => Promise<void>;
  refetchDailyReports: () => Promise<void>;
  refetchSupportNodes: () => Promise<void>;
  editForm: FormInstance;
  transForm: FormInstance;
  progForm: FormInstance;
  drForm: FormInstance;
  supportForm: FormInstance;
  privacyForm: FormInstance;
  memberForm: FormInstance<{ 姓名: string; 角色: TeamRole }>;
  onNavigateAfterDelete: () => void;
  setEditOpen: (v: boolean) => void;
  setTransitionOpen: (v: boolean) => void;
  setProgressOpen: (v: boolean) => void;
  setPrivacyDrawerOpen: (v: boolean) => void;
  setMemberDrawerOpen: (v: boolean) => void;
  editingMemberIdx: number | null;
  setEditingMemberIdx: (v: number | null) => void;
  editingDr: DailyReportEntry | null;
  setDrModalOpen: (v: boolean) => void;
  setEditingDr: (v: DailyReportEntry | null) => void;
  editingNode: SupportNode | null;
  setSupportModalOpen: (v: boolean) => void;
  setEditingNode: (v: SupportNode | null) => void;
}

export function useAttackDetailHandlers(args: UseAttackDetailHandlersArgs) {
  const { id, node, people, isPrivate, status, refetch, refetchDailyReports, refetchSupportNodes } = args;

  const [editSubmitting, setEditSubmitting] = useState(false);
  const [transSubmitting, setTransSubmitting] = useState(false);
  const [progSubmitting, setProgSubmitting] = useState(false);
  const [drSubmitting, setDrSubmitting] = useState(false);
  const [supportSubmitting, setSupportSubmitting] = useState(false);

  const [selectedPersonName, setSelectedPersonName] = useState<string | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<GraphNode | null>(null);
  const [personRelated, setPersonRelated] = useState<RelatedResult | null>(null);
  const [personPanelLoading, setPersonPanelLoading] = useState(false);
  const [drDetail, setDrDetail] = useState<DailyReportEntry | null>(null);

  const props = node?.properties ?? {};
  const members: TeamMember[] = parseMembers(props);

  const parsePrivacyJson = (key: string): string[] => {
    try {
      const v = JSON.parse(String(props[key] ?? "[]"));
      return Array.isArray(v) ? v.map(String) : [];
    } catch {
      return [];
    }
  };

  const handleEdit = async (values: Record<string, unknown>) => {
    if (!id) return;
    setEditSubmitting(true);
    try {
      const memberNames = Array.isArray(values["攻关成员"]) ? (values["攻关成员"] as string[]) : [];
      const leader = typeof values["攻关组长"] === "string" ? (values["攻关组长"] as string) : "";
      const synced = syncMemberFields(buildMembersFromForm(leader, memberNames));
      await api.updateNode(id, { ...values, ...synced });
      message.success("更新成功");
      args.setEditOpen(false);
      refetch();
    } catch (e) {
      handleApiError(e);
    } finally {
      setEditSubmitting(false);
    }
  };

  const openPrivacyDrawer = () => {
    args.privacyForm.setFieldsValue({
      授权人: parsePrivacyJson("私密授权人"),
      授权组: parsePrivacyJson("私密授权组"),
    });
    args.setPrivacyDrawerOpen(true);
  };

  const submitPrivacy = async (values: { 授权人?: string[]; 授权组?: string[] }) => {
    if (!id) return;
    try {
      await api.updateNode(id, {
        私密: "是",
        私密授权人: JSON.stringify(values.授权人 ?? []),
        私密授权组: JSON.stringify(values.授权组 ?? []),
      });
      args.setPrivacyDrawerOpen(false);
      await refetch();
      message.success(isPrivate ? "私密配置已更新" : "已设置为私密");
    } catch (e) {
      handleApiError(e);
    }
  };

  const cancelPrivacy = async () => {
    if (!id) return;
    try {
      await api.updateNode(id, { 私密: "否" });
      await refetch();
      message.success("已取消私密");
    } catch (e) {
      handleApiError(e);
    }
  };

  const updateMembers = async (next: TeamMember[]) => {
    if (!id) return;
    try {
      await api.updateNode(id, syncMemberFields(next));
      message.success("成员已更新");
      refetch();
    } catch (e) {
      handleApiError(e);
    }
  };

  const handleTransition = async (values: { toStatus: string; note?: string }) => {
    if (!id) return;
    setTransSubmitting(true);
    try {
      await api.transition(id, values.toStatus, values.note);
      message.success("状态流转成功");
      args.setTransitionOpen(false);
      args.transForm.resetFields();
      refetch();
    } catch (e) {
      handleApiError(e);
    } finally {
      setTransSubmitting(false);
    }
  };

  const handleAddProgress = async (values: { content: string }) => {
    if (!id) return;
    setProgSubmitting(true);
    try {
      await api.appendProgress(id, values.content, status);
      message.success("进展已追加");
      args.setProgressOpen(false);
      args.progForm.resetFields();
      refetch();
    } catch (e) {
      handleApiError(e);
    } finally {
      setProgSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    try {
      await api.deleteNode(id);
      message.success("已删除");
      args.onNavigateAfterDelete();
    } catch (e) {
      handleApiError(e);
    }
  };

  const createDailyReport = async (values: { type: string; currentProgress: string; nextSteps?: string }) => {
    if (!id) return;
    setDrSubmitting(true);
    try {
      if (args.editingDr) {
        await api.updateDailyReportEntry(id, args.editingDr.id, values);
        message.success("日报条目已更新");
      } else {
        await api.createDailyReportEntry(id, values);
        message.success("日报条目已创建");
      }
      args.setDrModalOpen(false);
      args.setEditingDr(null);
      args.drForm.resetFields();
      refetchDailyReports();
    } catch (e) {
      handleApiError(e);
    } finally {
      setDrSubmitting(false);
    }
  };

  const handleSupportSubmit = async (values: any) => {
    if (!id) return;
    setSupportSubmitting(true);
    try {
      if (args.editingNode) {
        await api.updateSupportNode(args.editingNode.id, values);
        message.success("节点已更新");
      } else {
        await api.createSupportNode(id, values);
        message.success("节点已添加");
      }
      args.setSupportModalOpen(false);
      args.supportForm.resetFields();
      args.setEditingNode(null);
      refetchSupportNodes();
    } catch (e) {
      handleApiError(e);
    } finally {
      setSupportSubmitting(false);
    }
  };

  const handleDeleteSupportNode = async (nodeId: string) => {
    try {
      await api.deleteSupportNode(nodeId);
      message.success("节点已删除");
      refetchSupportNodes();
    } catch (e) {
      handleApiError(e);
    }
  };

  const selectSupportPerson = async (name: string | null | undefined) => {
    const n = String(name ?? "").trim();
    setSelectedPersonName(n || null);
    setSelectedPerson(null);
    setPersonRelated(null);
    if (!n) return;
    const person = people.find((p) => String(p.properties["姓名"] ?? p.properties["name"] ?? "") === n);
    if (!person) return;
    setSelectedPerson(person);
    setPersonPanelLoading(true);
    try {
      setPersonRelated(await api.getRelated("person", person.id, { depth: 1 }));
    } catch {
      setPersonRelated(null);
    } finally {
      setPersonPanelLoading(false);
    }
  };

  const handleApplyTemplate = async (templateId: string) => {
    if (!id) return;
    try {
      const result = await api.applySupportTemplate(templateId, id);
      message.success(`已应用模板，创建 ${result.applied} 个节点`);
      refetchSupportNodes();
    } catch (e) {
      handleApiError(e);
    }
  };

  const openAddMember = () => {
    args.setEditingMemberIdx(null);
    args.memberForm.resetFields();
    args.memberForm.setFieldsValue({ 角色: "组员" });
    args.setMemberDrawerOpen(true);
  };

  const openEditMember = (idx: number) => {
    args.setEditingMemberIdx(idx);
    args.memberForm.setFieldsValue({ 姓名: members[idx].姓名, 角色: members[idx].角色 });
    args.setMemberDrawerOpen(true);
  };

  const submitMember = async (values: { 姓名: string; 角色: TeamRole }) => {
    const cleaned = { 姓名: String(values.姓名 ?? "").trim(), 角色: values.角色 || "组员" };
    if (!cleaned.姓名) {
      message.warning("请选择成员姓名");
      return;
    }
    let next: TeamMember[];
    if (args.editingMemberIdx == null) {
      if (members.some((m) => m.姓名 === cleaned.姓名)) {
        message.warning(`「${cleaned.姓名}」已在成员列表中`);
        return;
      }
      next = [...members, cleaned];
    } else {
      next = members.map((m, i) => (i === args.editingMemberIdx ? cleaned : m));
      const dupIdx = next.findIndex((m, i) => i !== args.editingMemberIdx && m.姓名 === cleaned.姓名);
      if (dupIdx >= 0) {
        message.warning(`「${cleaned.姓名}」已在成员列表中`);
        return;
      }
    }
    await updateMembers(next);
    args.setMemberDrawerOpen(false);
  };

  const deleteMember = async (idx: number) => {
    await updateMembers(members.filter((_, i) => i !== idx));
  };

  return {
    // submitting flags
    editSubmitting,
    transSubmitting,
    progSubmitting,
    drSubmitting,
    supportSubmitting,
    // support panel selection state
    selectedPersonName,
    selectedPerson,
    personRelated,
    personPanelLoading,
    // daily report detail modal
    drDetail,
    setDrDetail,
    // members
    members,
    // handlers
    handleEdit,
    openPrivacyDrawer,
    submitPrivacy,
    cancelPrivacy,
    handleTransition,
    handleAddProgress,
    handleDelete,
    createDailyReport,
    handleSupportSubmit,
    handleDeleteSupportNode,
    selectSupportPerson,
    handleApplyTemplate,
    openAddMember,
    openEditMember,
    submitMember,
    deleteMember,
  };
}
