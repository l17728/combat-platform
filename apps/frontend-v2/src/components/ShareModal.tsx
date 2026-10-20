import { useState, useEffect } from "react";
import { Modal, Input, Select, Button, Space, message, Typography, Tooltip, Tabs, Tag, List, Popconfirm } from "antd";
import {
  CopyOutlined,
  LinkOutlined,
  SendOutlined,
  TeamOutlined,
  BarChartOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
import { api } from "../api.js";
import { handleApiError } from "../utils/handleApiError.js";

const { Text } = Typography;

interface Props {
  open: boolean;
  onClose: () => void;
  entityType: "wiki" | "ticket" | "infoCard";
  entityId: string;
  entityTitle: string;
  onCopyToTicket?: (wikiId: string) => void;
}

const EXPIRY_OPTIONS = [
  { label: "1 小时", value: 3600 },
  { label: "1 天", value: 86400 },
  { label: "7 天", value: 604800 },
  { label: "30 天", value: 2592000 },
  { label: "永不过期", value: 0 },
];

export default function ShareModal({ open, onClose, entityType, entityId, entityTitle, onCopyToTicket }: Props) {
  const [tab, setTab] = useState("create");
  const [expiresIn, setExpiresIn] = useState(604800);
  const [password, setPassword] = useState("");
  const [usePassword, setUsePassword] = useState(false);
  const [generatedUrl, setGeneratedUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [targetUsers, setTargetUsers] = useState<string[]>([]);
  const [userSearch, setUserSearch] = useState("");
  const [userOptions, setUserOptions] = useState<{ label: string; value: string }[]>([]);
  const [ticketSearch, setTicketSearch] = useState("");
  const [copyTitle, setCopyTitle] = useState("");
  const [copying, setCopying] = useState(false);
  const [shareLinks, setShareLinks] = useState<any[]>([]);
  const [stats, setStats] = useState<{
    totalLinks: number;
    totalViews: number;
    dailyViews: { date: string; count: number }[];
  } | null>(null);

  useEffect(() => {
    if (open) {
      loadManageData();
      loadUsers();
    }
  }, [open, entityType, entityId]);

  const loadManageData = async () => {
    try {
      const [links, s] = await Promise.all([
        api.listShareLinks(entityType, entityId),
        api.getShareStats(entityType, entityId),
      ]);
      setShareLinks(links);
      setStats(s);
    } catch {}
  };

  const loadUsers = async () => {
    try {
      const users = await api.listUsers();
      setUserOptions(users.map((u: any) => ({ label: `${u.displayName} (${u.username})`, value: u.displayName })));
    } catch {}
  };

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const result = await api.createShareLink({
        entityType,
        entityId,
        password: usePassword ? password : undefined,
        expiresIn: expiresIn || undefined,
        targetUsers: targetUsers.length > 0 ? targetUsers : undefined,
      });
      setGeneratedUrl(result.url);
      message.success(targetUsers.length > 0 ? "已分享并通知目标用户" : "分享链接已生成");
      loadManageData();
    } catch (e) {
      handleApiError(e);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(generatedUrl).then(() => message.success("已复制到剪贴板"));
  };

  const handleCopyToTicket = async () => {
    if (!ticketSearch.trim()) {
      message.error("请输入目标攻关单 ID");
      return;
    }
    setCopying(true);
    try {
      const result = await api.copyWikiToTicket(entityId, ticketSearch.trim(), copyTitle || undefined);
      message.success(`已复制到攻关单: ${result.title}`);
      if (onCopyToTicket) onCopyToTicket(entityId);
      setTicketSearch("");
      setCopyTitle("");
    } catch (e) {
      handleApiError(e);
    } finally {
      setCopying(false);
    }
  };

  const handleRevoke = async (id: string) => {
    try {
      await api.revokeShareLink(id);
      message.success("已撤销");
      loadManageData();
    } catch (e) {
      handleApiError(e);
    }
  };

  const tabItems = [
    {
      key: "create",
      label: "创建分享",
      children: (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <Text strong style={{ display: "block", marginBottom: 8 }}>
              <LinkOutlined /> 生成分享链接
            </Text>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
              <Text style={{ flexShrink: 0 }}>有效期:</Text>
              <Select
                value={expiresIn}
                onChange={setExpiresIn}
                options={EXPIRY_OPTIONS}
                style={{ width: 120 }}
                size="small"
              />
              <Space size={4} style={{ marginLeft: 4 }}>
                <input type="checkbox" checked={usePassword} onChange={(e) => setUsePassword(e.target.checked)} />
                <Text>密码</Text>
              </Space>
              {usePassword && (
                <Input.Password
                  size="small"
                  placeholder="设置密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{ width: 120 }}
                />
              )}
            </div>
          </div>
          <div>
            <Text strong style={{ display: "block", marginBottom: 8 }}>
              <TeamOutlined /> 分享给站内用户（可选）
            </Text>
            <Select
              mode="multiple"
              size="small"
              placeholder="搜索用户..."
              value={targetUsers}
              onChange={setTargetUsers}
              options={userOptions}
              onSearch={setUserSearch}
              filterOption={(input, option) => (option?.label as string)?.toLowerCase().includes(input.toLowerCase())}
              style={{ width: "100%", marginBottom: 8 }}
              allowClear
            />
          </div>
          {!generatedUrl ? (
            <Button type="primary" icon={<SendOutlined />} loading={loading} onClick={handleGenerate} block>
              {targetUsers.length > 0 ? `分享并通知 ${targetUsers.length} 人` : "生成链接"}
            </Button>
          ) : (
            <div
              style={{
                background: "#f6f6f6",
                borderRadius: 6,
                padding: "8px 12px",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <Text ellipsis style={{ flex: 1, fontSize: 13 }}>
                {generatedUrl}
              </Text>
              <Tooltip title="复制链接">
                <Button type="text" icon={<CopyOutlined />} onClick={handleCopyUrl} />
              </Tooltip>
            </div>
          )}
          {entityType === "wiki" && (
            <div style={{ borderTop: "1px solid #f0f0f0", paddingTop: 16 }}>
              <Text strong style={{ display: "block", marginBottom: 8 }}>
                复制到攻关单知识库
              </Text>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <Input
                  size="small"
                  placeholder="目标攻关单 ID"
                  value={ticketSearch}
                  onChange={(e) => setTicketSearch(e.target.value)}
                />
                <Input
                  size="small"
                  placeholder={"新标题（留空则使用「副本: 原标题」）"}
                  value={copyTitle}
                  onChange={(e) => setCopyTitle(e.target.value)}
                />
                <Button loading={copying} onClick={handleCopyToTicket} block>
                  复制到攻关单
                </Button>
              </div>
            </div>
          )}
        </div>
      ),
    },
    {
      key: "manage",
      label: "分享管理",
      children: (
        <div>
          {stats && (
            <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
              <div>
                <Text type="secondary">链接数</Text>
                <br />
                <Text strong>{stats.totalLinks}</Text>
              </div>
              <div>
                <Text type="secondary">总浏览</Text>
                <br />
                <Text strong>{stats.totalViews}</Text>
              </div>
            </div>
          )}
          {stats && stats.dailyViews.length > 0 && (
            <div style={{ marginBottom: 16, padding: 12, background: "#fafafa", borderRadius: 6 }}>
              <Text strong style={{ display: "block", marginBottom: 8 }}>
                <BarChartOutlined /> 访问趋势（近30天）
              </Text>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 60 }}>
                {stats.dailyViews.slice(-30).map((d) => {
                  const max = Math.max(...stats.dailyViews.map((x) => x.count), 1);
                  const h = Math.max((d.count / max) * 50, 2);
                  return (
                    <Tooltip key={d.date} title={`${d.date}: ${d.count} 次`}>
                      <div style={{ width: 8, height: h, background: "#1677ff", borderRadius: 2 }} />
                    </Tooltip>
                  );
                })}
              </div>
            </div>
          )}
          <List
            size="small"
            dataSource={shareLinks}
            locale={{ emptyText: "暂无分享记录" }}
            renderItem={(link) => (
              <List.Item
                actions={[
                  link.revoked_at ? (
                    <Tag color="red">已撤销</Tag>
                  ) : (
                    <Popconfirm title="确认撤销此分享？" onConfirm={() => handleRevoke(link.id)}>
                      <Button size="small" danger icon={<DeleteOutlined />}>
                        撤销
                      </Button>
                    </Popconfirm>
                  ),
                ]}
              >
                <List.Item.Meta
                  title={
                    <span>
                      <Tag color={link.share_type === "internal" ? "blue" : "default"}>
                        {link.share_type === "internal" ? "站内" : "链接"}
                      </Tag>
                      <Text copyable={{ text: `${window.location.origin}/s/${link.token}` }} style={{ fontSize: 12 }}>
                        {link.token}
                      </Text>
                    </span>
                  }
                  description={
                    <span style={{ fontSize: 11 }}>
                      {link.shared_by} · {new Date(link.created_at).toLocaleString()}
                      {link.expires_at ? ` · 过期 ${new Date(link.expires_at).toLocaleString()}` : ""}
                      {link.current_views > 0 ? ` · ${link.current_views} 次浏览` : ""}
                    </span>
                  }
                />
              </List.Item>
            )}
          />
        </div>
      ),
    },
  ];

  return (
    <Modal title={`分享: ${entityTitle}`} open={open} onCancel={onClose} footer={null} width={560} destroyOnClose>
      <Tabs activeKey={tab} onChange={setTab} items={tabItems} size="small" />
    </Modal>
  );
}
