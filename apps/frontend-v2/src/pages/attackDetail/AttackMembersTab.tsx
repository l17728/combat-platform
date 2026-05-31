import { Button, Space, Avatar, Tag, Empty, Table, Popconfirm, Typography } from "antd";
import { PlusOutlined, UserOutlined } from "@ant-design/icons";
import type { TeamMember, TeamRole } from "../../utils/teamMembers.js";

const { Text } = Typography;

export interface AttackMembersTabProps {
  members: TeamMember[];
  onOpenAdd: () => void;
  onOpenEdit: (idx: number) => void;
  onDelete: (idx: number) => Promise<void> | void;
}

export default function AttackMembersTab({ members, onOpenAdd, onOpenEdit, onDelete }: AttackMembersTabProps) {
  const memberColumns = [
    {
      title: "姓名",
      dataIndex: "姓名",
      key: "姓名",
      render: (v: string) => (
        <Space>
          <Avatar size="small" icon={<UserOutlined />} />
          <Text strong>{v}</Text>
        </Space>
      ),
    },
    {
      title: "角色",
      dataIndex: "角色",
      key: "角色",
      width: 120,
      render: (v: TeamRole) => <Tag color={v === "组长" ? "gold" : "blue"}>{v}</Tag>,
    },
    {
      title: "操作",
      key: "op",
      width: 140,
      render: (_: unknown, _r: TeamMember, idx: number) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => onOpenEdit(idx)}>
            修改角色
          </Button>
          <Popconfirm title={`确认移除「${members[idx].姓名}」？`} onConfirm={() => onDelete(idx)}>
            <Button type="link" size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: "16px 0" }}>
      <Space style={{ marginBottom: 12 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={onOpenAdd}>
          添加成员
        </Button>
        <Text type="secondary">
          共 {members.length} 人 · 组长 {members.filter((m) => m.角色 === "组长").length} · 组员{" "}
          {members.filter((m) => m.角色 === "组员").length}
        </Text>
      </Space>
      {members.length === 0 ? (
        <Empty description="暂无成员,点击「添加成员」开始组建团队" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <Table size="small" rowKey={(r) => r.姓名} dataSource={members} columns={memberColumns} pagination={false} />
      )}
    </div>
  );
}
