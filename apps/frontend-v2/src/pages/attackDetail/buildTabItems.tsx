import {
  LinkOutlined,
  FileTextOutlined,
  InfoCircleOutlined,
  TeamOutlined,
  SwapOutlined,
  NodeIndexOutlined,
  MessageOutlined,
} from "@ant-design/icons";
import { message } from "antd";
import type { FormInstance } from "antd";
import { api, type TicketTab } from "../../api.js";
import type { FieldSchema, GraphNode, ProgressLog, AuditLogEntry } from "@combat/shared";
import type { DailyReportEntry, SupportNode, SupportTemplate, RelatedResult } from "../../api.js";
import type { TeamMember } from "../../utils/teamMembers.js";
import AttackBasicInfoTab from "./AttackBasicInfoTab.js";
import AttackMembersTab from "./AttackMembersTab.js";
import AttackProgressTimelineTab from "./AttackProgressTimelineTab.js";
import AttackDailyReportTab from "./AttackDailyReportTab.js";
import AttackSupportNetworkTab from "./AttackSupportNetworkTab.js";
import DynamicLinkTab from "../../components/DynamicLinkTab.js";
import DynamicCustomTab from "../../components/DynamicCustomTab.js";
import WelinkTab from "../WelinkTab.js";

export interface BuildTabItemsArgs {
  id: string;
  isLeader: boolean;
  queryWelinkMsg?: string;

  // basic
  node: GraphNode;
  basicFields: FieldSchema[];
  hiddenBasicFields: string[];
  setHiddenBasicFields: (v: string[]) => void;

  // members
  members: TeamMember[];
  openAddMember: () => void;
  openEditMember: (idx: number) => void;
  deleteMember: (idx: number) => Promise<void> | void;

  // progress
  progress: ProgressLog[];
  auditLogs: AuditLogEntry[];
  setProgressOpen: (v: boolean) => void;

  // daily report
  dailyReports: DailyReportEntry[];
  drLoading: boolean;
  drForm: FormInstance;
  setEditingDr: (v: DailyReportEntry | null) => void;
  setDrModalOpen: (v: boolean) => void;
  setDrDetail: (v: DailyReportEntry | null) => void;
  refetchDailyReports: () => Promise<void>;

  // support
  supportNodes: SupportNode[];
  supportLoading: boolean;
  templates: SupportTemplate[];
  selectedPersonName: string | null;
  selectedPerson: GraphNode | null;
  personRelated: RelatedResult | null;
  personPanelLoading: boolean;
  supportForm: FormInstance;
  setSupportModalOpen: (v: boolean) => void;
  setEditingNode: (v: SupportNode | null) => void;
  handleDeleteSupportNode: (nodeId: string) => Promise<void> | void;
  selectSupportPerson: (name: string | null | undefined) => Promise<void> | void;
  handleApplyTemplate: (templateId: string) => Promise<void> | void;

  // dynamic tabs
  dynamicTabs: TicketTab[];
  setDynamicTabs: React.Dispatch<React.SetStateAction<TicketTab[]>>;
}

export function buildAllTabItems(a: BuildTabItemsArgs) {
  const fixedTabItems = [
    {
      key: "basic",
      label: (
        <span>
          <InfoCircleOutlined /> 基础信息
        </span>
      ),
      children: (
        <AttackBasicInfoTab
          node={a.node}
          basicFields={a.basicFields}
          hiddenBasicFields={a.hiddenBasicFields}
          onHiddenChange={a.setHiddenBasicFields}
        />
      ),
    },
    {
      key: "members",
      label: (
        <span>
          <TeamOutlined /> 成员管理
        </span>
      ),
      children: (
        <AttackMembersTab
          members={a.members}
          onOpenAdd={a.openAddMember}
          onOpenEdit={a.openEditMember}
          onDelete={a.deleteMember}
        />
      ),
    },
    {
      key: "welink",
      label: (
        <span>
          <MessageOutlined /> Welink 消息
        </span>
      ),
      children: <WelinkTab ticketId={a.id} highlightMessageId={a.queryWelinkMsg} />,
    },
    {
      key: "progress",
      label: (
        <span>
          <SwapOutlined /> 进展同步
        </span>
      ),
      children: (
        <AttackProgressTimelineTab
          ticketId={a.id}
          progress={a.progress}
          auditLogs={a.auditLogs}
          isLeader={a.isLeader}
          onOpenAddProgress={() => a.setProgressOpen(true)}
        />
      ),
    },
    {
      key: "dailyReport",
      label: (
        <span>
          <FileTextOutlined /> 日报更新
        </span>
      ),
      children: (
        <AttackDailyReportTab
          dailyReports={a.dailyReports}
          drLoading={a.drLoading}
          onOpenCreate={() => {
            a.setEditingDr(null);
            a.drForm.resetFields();
            a.setDrModalOpen(true);
          }}
          onOpenEdit={(r) => {
            a.setEditingDr(r);
            a.drForm.setFieldsValue({
              type: r.type,
              currentProgress: r.currentProgress,
              nextSteps: r.nextSteps,
            });
            a.setDrModalOpen(true);
          }}
          onOpenDetail={(r) => a.setDrDetail(r)}
          onPublish={async (entryId) => {
            await api.publishDailyReportEntry(a.id, entryId);
            message.success("已发布");
            a.refetchDailyReports();
          }}
          onDelete={async (entryId) => {
            await api.deleteDailyReportEntry(a.id, entryId);
            message.success("已删除");
            a.refetchDailyReports();
          }}
        />
      ),
    },
    {
      key: "support",
      label: (
        <span>
          <NodeIndexOutlined /> 求助网络
        </span>
      ),
      children: (
        <AttackSupportNetworkTab
          supportNodes={a.supportNodes}
          supportLoading={a.supportLoading}
          templates={a.templates}
          selectedPersonName={a.selectedPersonName}
          selectedPerson={a.selectedPerson}
          personRelated={a.personRelated}
          personPanelLoading={a.personPanelLoading}
          onOpenAdd={() => {
            a.setEditingNode(null);
            a.supportForm.resetFields();
            a.supportForm.setFieldsValue({ status: "待确认" });
            a.setSupportModalOpen(true);
          }}
          onOpenEdit={(nd) => {
            a.setEditingNode(nd);
            a.supportForm.setFieldsValue({
              parentId: nd.parentId ?? undefined,
              category: nd.category,
              domain: nd.domain,
              personName: nd.personName ?? undefined,
              status: nd.status,
              note: nd.note,
            });
            a.setSupportModalOpen(true);
          }}
          onDeleteNode={a.handleDeleteSupportNode}
          onSelectPerson={a.selectSupportPerson}
          onApplyTemplate={a.handleApplyTemplate}
        />
      ),
    },
  ];

  const dynamicTabItems = a.dynamicTabs.map((tab) => ({
    key: tab.id,
    label: (
      <span style={tab.tabType === "custom" && tab.title === "信息广场" ? { color: "#999" } : undefined}>
        {tab.tabType === "link" ? <LinkOutlined /> : <FileTextOutlined />} {tab.title}
      </span>
    ),
    closable: true,
    children:
      tab.tabType === "link" ? (
        <DynamicLinkTab
          ticketId={a.id}
          tab={tab}
          onDeleted={(tid) => a.setDynamicTabs((prev) => prev.filter((t) => t.id !== tid))}
        />
      ) : (
        <DynamicCustomTab
          ticketId={a.id}
          tab={tab}
          onDeleted={(tid) => a.setDynamicTabs((prev) => prev.filter((t) => t.id !== tid))}
          onUpdate={(u) => a.setDynamicTabs((prev) => prev.map((t) => (t.id === u.id ? u : t)))}
        />
      ),
  }));

  return [...fixedTabItems.map((item) => ({ ...item, closable: false })), ...dynamicTabItems];
}
