import {
  Drawer,
  Form,
  Input,
  Select,
  Button,
  Modal,
  Space,
  Card,
  Steps,
  Tag,
  Divider,
  Alert,
  Descriptions,
  Typography,
} from "antd";
import StatusTag from "../../components/StatusTag.js";
import AddTabModal from "../../components/AddTabModal.js";
import { DATE_FORMAT } from "../../constants.js";
import { STATUS_STEPS, STATUS_STEP_ICON, getStatusStepIndex } from "./AttackDetailHeader.js";
import type { FormInstance } from "antd";
import type { FieldSchema, GraphNode } from "@combat/shared";
import type { TeamRole } from "../../utils/teamMembers.js";
import type { DailyReportEntry, SupportNode } from "../../api.js";
import dayjs from "dayjs";

const { Text } = Typography;

export interface AttackDetailDrawersProps {
  ticketId: string;
  status: string;
  isPrivate: boolean;
  emailGroups: GraphNode[];
  personOptions: { value: string; label: string }[];
  extraEditFields: FieldSchema[];
  STATUS_OPTIONS: string[];
  ROLE_OPTIONS: TeamRole[];
  DR_TYPES: string[];
  SUPPORT_CATEGORIES: string[];
  SUPPORT_STATUSES: string[];

  // Edit drawer
  editForm: FormInstance;
  editOpen: boolean;
  editSubmitting: boolean;
  onEditClose: () => void;
  onEditSubmit: (values: Record<string, unknown>) => Promise<void> | void;

  // Transition drawer
  transForm: FormInstance;
  transitionOpen: boolean;
  transSubmitting: boolean;
  onTransitionClose: () => void;
  onTransitionSubmit: (values: { toStatus: string; note?: string }) => Promise<void> | void;

  // Privacy drawer
  privacyForm: FormInstance;
  privacyDrawerOpen: boolean;
  onPrivacyClose: () => void;
  onPrivacySubmit: (values: { 授权人?: string[]; 授权组?: string[] }) => Promise<void> | void;

  // Member drawer
  memberForm: FormInstance<{ 姓名: string; 角色: TeamRole }>;
  memberDrawerOpen: boolean;
  editingMemberIdx: number | null;
  onMemberClose: () => void;
  onMemberSubmit: (values: { 姓名: string; 角色: TeamRole }) => Promise<void> | void;

  // Progress drawer
  progForm: FormInstance;
  progressOpen: boolean;
  progSubmitting: boolean;
  onProgressClose: () => void;
  onProgressSubmit: (values: { content: string }) => Promise<void> | void;

  // Daily report modal
  drForm: FormInstance;
  drModalOpen: boolean;
  drSubmitting: boolean;
  editingDr: DailyReportEntry | null;
  onDrClose: () => void;
  onDrSubmit: (values: { type: string; currentProgress: string; nextSteps?: string }) => Promise<void> | void;

  // Daily report detail modal
  drDetail: DailyReportEntry | null;
  onDrDetailClose: () => void;

  // Support modal
  supportForm: FormInstance;
  supportModalOpen: boolean;
  supportSubmitting: boolean;
  editingSupportNode: SupportNode | null;
  supportNodes: SupportNode[];
  onSupportClose: () => void;
  onSupportSubmit: (values: any) => Promise<void> | void;

  // Add tab modal
  addTabOpen: boolean;
  onAddTabClose: () => void;
  onTabAdded: (tab: any) => void;
}

export default function AttackDetailDrawers(p: AttackDetailDrawersProps) {
  const currentStep = getStatusStepIndex(p.status);
  return (
    <>
      <Drawer
        title="编辑攻关信息"
        width={520}
        open={p.editOpen}
        onClose={p.onEditClose}
        destroyOnClose
        maskClosable={false}
        extra={
          <Button type="primary" loading={p.editSubmitting} onClick={() => p.editForm.submit()}>
            保存
          </Button>
        }
      >
        <Form form={p.editForm} layout="vertical" onFinish={p.onEditSubmit}>
          <Divider orientation="left" orientationMargin={0}>
            基本信息
          </Divider>
          <Form.Item name="标题" label="标题" rules={[{ required: true, message: "标题不能为空" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="状态" label="状态">
            <Select options={p.STATUS_OPTIONS.map((s) => ({ value: s, label: s }))} />
          </Form.Item>
          <Form.Item name="问题单号" label="问题单号">
            <Input />
          </Form.Item>
          <Form.Item name="事件单号" label="事件单号">
            <Input />
          </Form.Item>
          <Form.Item name="事件级别" label="事件级别">
            <Input />
          </Form.Item>
          <Form.Item name="客户名称" label="客户名称">
            <Input />
          </Form.Item>
          <Divider orientation="left" orientationMargin={0}>
            人员信息
          </Divider>
          <Form.Item name="当前处理人" label="当前处理人">
            <Select
              showSearch
              allowClear
              placeholder="搜索人员"
              options={p.personOptions}
              filterOption={(input, option) => (option?.label as string)?.toLowerCase().includes(input.toLowerCase())}
            />
          </Form.Item>
          <Form.Item name="攻关组长" label="攻关组长">
            <Select
              showSearch
              allowClear
              placeholder="搜索人员"
              options={p.personOptions}
              filterOption={(input, option) => (option?.label as string)?.toLowerCase().includes(input.toLowerCase())}
            />
          </Form.Item>
          <Form.Item name="攻关成员" label="攻关成员" tooltip="多选组员;组长在上方选,不要重复">
            <Select
              mode="multiple"
              showSearch
              allowClear
              placeholder="从全员名单多选组员"
              options={p.personOptions}
              filterOption={(input, option) => (option?.label as string)?.toLowerCase().includes(input.toLowerCase())}
            />
          </Form.Item>
          <Form.Item name="攻关申请人" label="攻关申请人">
            <Select
              showSearch
              allowClear
              placeholder="搜索人员"
              options={p.personOptions}
              filterOption={(input, option) => (option?.label as string)?.toLowerCase().includes(input.toLowerCase())}
            />
          </Form.Item>
          <Divider orientation="left" orientationMargin={0}>
            详细信息
          </Divider>
          <Form.Item name="影响及现存风险" label="影响及现存风险">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="资源ID" label="资源ID">
            <Input />
          </Form.Item>
          <Form.Item name="租户ID" label="租户ID">
            <Input />
          </Form.Item>
          {p.extraEditFields.length > 0 && (
            <>
              <Divider orientation="left" orientationMargin={0}>
                其它字段
              </Divider>
              {p.extraEditFields.map((f) => (
                <Form.Item key={f.id} name={f.name} label={f.label}>
                  {f.type === "enum" ? (
                    <Select allowClear options={(f.enumValues ?? []).map((v) => ({ value: v, label: v }))} />
                  ) : f.type === "number" ? (
                    <Input type="number" placeholder={f.label} />
                  ) : f.type === "date" ? (
                    <Input type="date" />
                  ) : f.type === "datetime" ? (
                    <Input type="datetime-local" />
                  ) : (
                    <Input placeholder={f.label} />
                  )}
                </Form.Item>
              ))}
            </>
          )}
        </Form>
      </Drawer>

      <Drawer
        title="状态流转"
        width={400}
        open={p.transitionOpen}
        onClose={p.onTransitionClose}
        destroyOnClose
        maskClosable={false}
      >
        <Form form={p.transForm} layout="vertical" onFinish={p.onTransitionSubmit}>
          <div style={{ marginBottom: 16 }}>
            <Text type="secondary">当前状态：</Text>
            <StatusTag status={p.status} />
          </div>
          <Card size="small" style={{ marginBottom: 16 }}>
            <Steps
              size="small"
              current={currentStep}
              items={STATUS_STEPS.map((s, i) => ({
                title: s,
                icon: STATUS_STEP_ICON[s],
                status: i < currentStep ? "finish" : i === currentStep ? "process" : "wait",
              }))}
            />
          </Card>
          <Form.Item name="toStatus" label="目标状态" rules={[{ required: true, message: "请选择目标状态" }]}>
            <Select
              options={p.STATUS_OPTIONS.filter((s) => s !== p.status).map((s) => ({
                value: s,
                label: s,
              }))}
            />
          </Form.Item>
          <Form.Item name="note" label="备注">
            <Input.TextArea rows={3} placeholder="状态变更原因..." />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={p.transSubmitting} block>
            确认流转
          </Button>
        </Form>
      </Drawer>

      <Drawer
        title={p.isPrivate ? "管理私密授权" : "设置私密"}
        width={520}
        open={p.privacyDrawerOpen}
        onClose={p.onPrivacyClose}
        destroyOnClose
        maskClosable={false}
        extra={
          <Button type="primary" onClick={() => p.privacyForm.submit()}>
            {p.isPrivate ? "保存" : "设为私密"}
          </Button>
        }
      >
        <Alert
          type="info"
          showIcon
          message="私密攻关单的访问规则"
          description={
            <div>
              <div>• 创建人本人 + 成员管理 tab 内的所有成员(组长 / 组员)默认可访问</div>
              <div>• 额外指定的人员/邮件群组(下方两个多选)也将获得访问权限</div>
              <div>• 列表里会在标题前显示 🔒 提醒</div>
            </div>
          }
          style={{ marginBottom: 16 }}
        />
        <Form form={p.privacyForm} layout="vertical" onFinish={p.onPrivacySubmit}>
          <Form.Item name="授权人" label="指定授权人员" tooltip="支持搜索快速定位;成员无需在此重复添加">
            <Select
              mode="multiple"
              showSearch
              allowClear
              placeholder="从全员名单多选(可搜索姓名/部门)"
              options={p.personOptions}
              filterOption={(input, option) => (option?.label as string)?.toLowerCase().includes(input.toLowerCase())}
            />
          </Form.Item>
          <Form.Item name="授权组" label="指定授权邮件群组" tooltip="选中后该群组所有成员邮箱对应的人都可访问">
            <Select
              mode="multiple"
              showSearch
              allowClear
              placeholder="从邮件群组多选(可搜索组名)"
              options={p.emailGroups.map((g) => ({
                value: String(g.properties["组名"] ?? ""),
                label: `${g.properties["组名"] ?? "-"} ${g.properties["描述"] ? `(${g.properties["描述"]})` : ""}`,
              }))}
              filterOption={(input, option) => (option?.label as string)?.toLowerCase().includes(input.toLowerCase())}
            />
          </Form.Item>
        </Form>
      </Drawer>

      <Drawer
        title={p.editingMemberIdx == null ? "添加成员" : "修改成员角色"}
        width={400}
        open={p.memberDrawerOpen}
        onClose={p.onMemberClose}
        destroyOnClose
        maskClosable={false}
        extra={
          <Button type="primary" onClick={() => p.memberForm.submit()}>
            {p.editingMemberIdx == null ? "添加" : "保存"}
          </Button>
        }
      >
        <Form form={p.memberForm} layout="vertical" onFinish={p.onMemberSubmit} initialValues={{ 角色: "组员" }}>
          <Form.Item name="姓名" label="姓名" rules={[{ required: true, message: "请选择成员" }]}>
            <Select
              showSearch
              allowClear
              placeholder="从全员名单搜索"
              disabled={p.editingMemberIdx != null}
              options={p.personOptions}
              filterOption={(input, option) => (option?.label as string)?.toLowerCase().includes(input.toLowerCase())}
            />
          </Form.Item>
          <Form.Item name="角色" label="角色" rules={[{ required: true, message: "请选择角色" }]}>
            <Select options={p.ROLE_OPTIONS.map((r) => ({ value: r, label: r }))} />
          </Form.Item>
        </Form>
      </Drawer>

      <Drawer
        title="追加进展"
        width={400}
        open={p.progressOpen}
        onClose={p.onProgressClose}
        destroyOnClose
        maskClosable={false}
      >
        <Form form={p.progForm} layout="vertical" onFinish={p.onProgressSubmit}>
          <div style={{ marginBottom: 16 }}>
            <Text type="secondary">当前状态：</Text>
            <StatusTag status={p.status} />
          </div>
          <Form.Item name="content" label="进展内容" rules={[{ required: true, message: "请输入进展" }]}>
            <Input.TextArea rows={5} placeholder="描述当前进展..." />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={p.progSubmitting} block>
            提交进展
          </Button>
        </Form>
      </Drawer>

      <Modal
        title={p.editingDr ? "编辑日报条目" : "创建日报条目"}
        open={p.drModalOpen}
        onCancel={p.onDrClose}
        footer={null}
        destroyOnClose
      >
        <Form form={p.drForm} layout="vertical" initialValues={{ type: "进展通报" }} onFinish={p.onDrSubmit}>
          <Form.Item name="type" label="日报类型">
            <Select options={p.DR_TYPES.map((t) => ({ value: t, label: t }))} />
          </Form.Item>
          <Form.Item name="currentProgress" label="当前进展" rules={[{ required: true, message: "当前进展必填" }]}>
            <Input.TextArea rows={4} placeholder="请输入当前进展..." />
          </Form.Item>
          <Form.Item name="nextSteps" label="下一步计划">
            <Input.TextArea rows={3} placeholder="请输入下一步计划..." />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0, textAlign: "right" }}>
            <Space>
              <Button onClick={p.onDrClose}>取消</Button>
              <Button type="primary" htmlType="submit" loading={p.drSubmitting}>
                提交
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="日报条目详情"
        open={!!p.drDetail}
        onCancel={p.onDrDetailClose}
        footer={<Button onClick={p.onDrDetailClose}>关闭</Button>}
        width={720}
        destroyOnClose
      >
        {p.drDetail && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="日报类型">{p.drDetail.type}</Descriptions.Item>
            <Descriptions.Item label="状态">
              <Tag color={p.drDetail.status === "已发布" ? "green" : "default"}>{p.drDetail.status}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="当前进展">
              <div style={{ whiteSpace: "pre-wrap" }}>{p.drDetail.currentProgress}</div>
            </Descriptions.Item>
            <Descriptions.Item label="下一步计划">
              <div style={{ whiteSpace: "pre-wrap" }}>{p.drDetail.nextSteps || "--"}</div>
            </Descriptions.Item>
            <Descriptions.Item label="创建时间">{dayjs(p.drDetail.createdAt).format(DATE_FORMAT)}</Descriptions.Item>
          </Descriptions>
        )}
      </Modal>

      <Modal
        title={p.editingSupportNode ? "编辑求助节点" : "添加求助节点"}
        open={p.supportModalOpen}
        onCancel={p.onSupportClose}
        footer={null}
        destroyOnClose
      >
        <Form form={p.supportForm} layout="vertical" onFinish={p.onSupportSubmit}>
          <Form.Item name="parentId" label="上级节点（求助对象/人）">
            <Select
              allowClear
              placeholder="选择上级求助对象"
              options={p.supportNodes
                .filter((sn) => !p.editingSupportNode || sn.id !== p.editingSupportNode.id)
                .map((sn) => ({ value: sn.id, label: `${sn.personName || "待指定"}（${sn.domain}）` }))}
            />
          </Form.Item>
          <Form.Item name="category" label="大类" rules={[{ required: true, message: "请选择大类" }]}>
            <Select placeholder="选择大类" options={p.SUPPORT_CATEGORIES.map((c) => ({ value: c, label: c }))} />
          </Form.Item>
          <Form.Item name="domain" label="具体领域" rules={[{ required: true, message: "请输入具体领域" }]}>
            <Input placeholder="请输入具体领域" />
          </Form.Item>
          <Form.Item name="personName" label="负责人姓名（可选）">
            <Select
              showSearch
              allowClear
              placeholder="从全员名单搜索"
              options={p.personOptions}
              filterOption={(input, option) => (option?.label as string)?.toLowerCase().includes(input.toLowerCase())}
            />
          </Form.Item>
          <Form.Item name="status" label="状态" initialValue="待确认">
            <Select options={p.SUPPORT_STATUSES.map((s) => ({ value: s, label: s }))} />
          </Form.Item>
          <Form.Item name="note" label="备注">
            <Input.TextArea rows={3} placeholder="备注..." />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0, textAlign: "right" }}>
            <Space>
              <Button onClick={p.onSupportClose}>取消</Button>
              <Button type="primary" htmlType="submit" loading={p.supportSubmitting}>
                提交
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      <AddTabModal ticketId={p.ticketId} open={p.addTabOpen} onClose={p.onAddTabClose} onCreated={p.onTabAdded} />
    </>
  );
}
