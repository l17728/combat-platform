import { useState } from "react";
import { Modal, Radio, Input, Select, Button, Space, message, Typography, Tooltip } from "antd";
import { CopyOutlined, LinkOutlined, SendOutlined } from "@ant-design/icons";
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
  const [expiresIn, setExpiresIn] = useState(604800);
  const [password, setPassword] = useState("");
  const [usePassword, setUsePassword] = useState(false);
  const [generatedUrl, setGeneratedUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [ticketSearch, setTicketSearch] = useState("");
  const [copyTitle, setCopyTitle] = useState("");
  const [copying, setCopying] = useState(false);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const result = await api.createShareLink({
        entityType,
        entityId,
        password: usePassword ? password : undefined,
        expiresIn: expiresIn || undefined,
      });
      setGeneratedUrl(result.url);
      message.success("分享链接已生成");
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

  return (
    <Modal title={`分享: ${entityTitle}`} open={open} onCancel={onClose} footer={null} width={520} destroyOnClose>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <Text strong style={{ display: "block", marginBottom: 8 }}>
            <LinkOutlined /> 生成分享链接
          </Text>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <Text style={{ flexShrink: 0 }}>有效期:</Text>
            <Select
              value={expiresIn}
              onChange={setExpiresIn}
              options={EXPIRY_OPTIONS}
              style={{ width: 140 }}
              size="small"
            />
            <Space size={4} style={{ marginLeft: 8 }}>
              <input type="checkbox" checked={usePassword} onChange={(e) => setUsePassword(e.target.checked)} />
              <Text>访问密码</Text>
            </Space>
            {usePassword && (
              <Input.Password
                size="small"
                placeholder="设置密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ width: 140 }}
              />
            )}
          </div>
          {!generatedUrl ? (
            <Button type="primary" icon={<SendOutlined />} loading={loading} onClick={handleGenerate} block>
              生成链接
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
        </div>

        {entityType === "wiki" && (
          <>
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
          </>
        )}
      </div>
    </Modal>
  );
}
