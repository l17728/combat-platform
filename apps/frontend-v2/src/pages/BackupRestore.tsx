import { useState, useEffect, useCallback } from "react";
import {
  Typography,
  Card,
  Table,
  Button,
  Space,
  message,
  Popconfirm,
  Upload,
  Modal,
  Switch,
  InputNumber,
  Select,
  Alert,
  Divider,
  Tag,
} from "antd";
import {
  PlusOutlined,
  DownloadOutlined,
  DeleteOutlined,
  UploadOutlined,
  CloudUploadOutlined,
  ClockCircleOutlined,
} from "@ant-design/icons";
import { api, type BackupInfo, type BackupSchedule } from "../api.js";
import dayjs from "dayjs";
import HelpButton from "../components/HelpButton.js";
import HELP from "../help-content.js";
import { handleApiError } from "../utils/handleApiError.js";

const { Title, Text } = Typography;

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

const INTERVAL_OPTIONS = [
  { value: 24, label: "每天" },
  { value: 168, label: "每周" },
  { value: 720, label: "每月" },
];

export default function BackupRestore() {
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [schedule, setScheduleState] = useState<BackupSchedule | null>(null);
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const fetchBackups = useCallback(async (silent?: boolean) => {
    if (!silent) setLoading(true);
    try {
      const [list, sch] = await Promise.all([api.listBackups(), api.getBackupSchedule()]);
      setBackups(list);
      setScheduleState(sch);
    } catch (e) {
      handleApiError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBackups();
  }, [fetchBackups]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      await api.createBackup();
      message.success("备份已创建");
      fetchBackups(true);
    } catch (e) {
      handleApiError(e);
    } finally {
      setCreating(false);
    }
  };

  const handleDownload = async (filename: string) => {
    try {
      const blob = await api.downloadBackup(filename);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      handleApiError(e);
    }
  };

  const handleDelete = async (filename: string) => {
    try {
      await api.deleteBackup(filename);
      message.success("已删除");
      fetchBackups(true);
    } catch (e) {
      handleApiError(e);
    }
  };

  const handleRestore = async (file: File) => {
    setRestoring(true);
    try {
      await api.restoreBackup(file);
      message.success("数据库恢复中，服务即将重启...");
      setRestoreModalOpen(false);
    } catch (e) {
      handleApiError(e);
    } finally {
      setRestoring(false);
    }
  };

  const handleScheduleChange = async (patch: Partial<BackupSchedule>) => {
    try {
      const updated = await api.setBackupSchedule(patch);
      setScheduleState(updated);
      message.success("定时备份设置已更新");
    } catch (e) {
      handleApiError(e);
    }
  };

  const columns = [
    {
      title: "文件名",
      dataIndex: "filename",
      key: "filename",
      render: (fn: string) => <Text code>{fn}</Text>,
    },
    {
      title: "大小",
      dataIndex: "size",
      key: "size",
      width: 120,
      render: (s: number) => formatSize(s),
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 200,
      render: (t: string) => <span title={t}>{dayjs(t).format("YYYY-MM-DD HH:mm:ss")}</span>,
    },
    {
      title: "操作",
      key: "ops",
      width: 180,
      fixed: "right" as const,
      render: (_: unknown, row: BackupInfo) => (
        <Space>
          <a onClick={() => handleDownload(row.filename)}>
            <DownloadOutlined /> 下载
          </a>
          <Popconfirm title="确认删除此备份？" onConfirm={() => handleDelete(row.filename)}>
            <a style={{ color: "#ff4d4f" }}>
              <DeleteOutlined /> 删除
            </a>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <Space>
          <Title level={4} style={{ margin: 0 }}>
            数据库备份与恢复
          </Title>
          <HelpButton title={HELP.backupRestore.title} content={HELP.backupRestore.content} />
        </Space>
        <Space>
          <Button icon={<PlusOutlined />} type="primary" loading={creating} onClick={handleCreate}>
            立即备份
          </Button>
          <Button icon={<UploadOutlined />} danger onClick={() => setRestoreModalOpen(true)}>
            恢复数据库
          </Button>
        </Space>
      </div>

      <Card
        title={
          <Space>
            <ClockCircleOutlined /> 定时备份设置
          </Space>
        }
        size="small"
        style={{ marginBottom: 16 }}
      >
        <Space wrap style={{ marginBottom: 12 }}>
          <Text>启用定时备份：</Text>
          <Switch checked={schedule?.enabled ?? true} onChange={(v) => handleScheduleChange({ enabled: v })} />
        </Space>
        <Space wrap style={{ opacity: schedule?.enabled ? 1 : 0.5 }}>
          <Text>备份频率：</Text>
          <Select
            style={{ width: 120 }}
            value={schedule?.intervalHours || 168}
            onChange={(v) => handleScheduleChange({ intervalHours: v })}
            options={INTERVAL_OPTIONS}
          />
          <Text>保留份数：</Text>
          <InputNumber
            min={1}
            max={52}
            value={schedule?.keepCount || 4}
            onChange={(v) => v && handleScheduleChange({ keepCount: v })}
          />
          {schedule?.lastBackupAt && (
            <Tag color="blue">上次备份: {dayjs(schedule.lastBackupAt).format("YYYY-MM-DD HH:mm")}</Tag>
          )}
        </Space>
      </Card>

      <Card title="备份列表" size="small">
        <Table
          rowKey="filename"
          dataSource={backups}
          columns={columns}
          loading={loading}
          size="middle"
          pagination={false}
          locale={{ emptyText: "暂无备份文件" }}
        />
      </Card>

      <Modal
        title="恢复数据库"
        open={restoreModalOpen}
        onCancel={() => setRestoreModalOpen(false)}
        footer={null}
        width={520}
        destroyOnClose
      >
        <Alert
          type="error"
          showIcon
          message="危险操作"
          description="恢复数据库将用上传的备份文件完全替换当前数据库，服务将自动重启。此操作不可撤销！"
          style={{ marginBottom: 16 }}
        />
        <Upload.Dragger
          accept=".db"
          showUploadList={false}
          customRequest={({ file }) => handleRestore(file as File)}
          disabled={restoring}
        >
          <p className="ant-upload-drag-icon">
            <CloudUploadOutlined style={{ fontSize: 32, color: "#ff4d4f" }} />
          </p>
          <p className="ant-upload-text">点击或拖拽 .db 备份文件到此处</p>
          <p className="ant-upload-hint">仅支持 .db 格式的 SQLite 数据库文件</p>
        </Upload.Dragger>
        {restoring && (
          <div style={{ textAlign: "center", marginTop: 16 }}>
            <Text type="warning">正在恢复数据库，请等待服务重启...</Text>
          </div>
        )}
      </Modal>
    </div>
  );
}
