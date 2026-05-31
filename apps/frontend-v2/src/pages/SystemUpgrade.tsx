import { useEffect, useState, useRef } from "react";
import {
  Typography,
  Card,
  Button,
  Space,
  Alert,
  Statistic,
  Row,
  Col,
  Steps,
  Progress,
  message,
  Tag,
  Descriptions,
  Upload,
  Drawer,
  Table,
  Input,
  Checkbox,
  Modal,
  Tabs,
  Empty,
} from "antd";
import {
  WarningOutlined,
  RollbackOutlined,
  ReloadOutlined,
  PlayCircleOutlined,
  InboxOutlined,
  FileSearchOutlined,
} from "@ant-design/icons";
import { api } from "../api.js";
import { useAuth } from "../hooks/useAuth.js";

const { Title, Text, Paragraph } = Typography;
const { Dragger } = Upload;

type Phase =
  | "idle"
  | "queued"
  | "backup"
  | "extract"
  | "schema-merge"
  | "secrets"
  | "code-swap"
  | "restart"
  | "health"
  | "done"
  | "failed"
  | "rolled-back";

const PHASE_STEPS: { key: Phase; title: string }[] = [
  { key: "queued", title: "排队" },
  { key: "backup", title: "备份" },
  { key: "extract", title: "解包" },
  { key: "schema-merge", title: "Schema 合并" },
  { key: "secrets", title: "密钥检查" },
  { key: "code-swap", title: "代码替换" },
  { key: "restart", title: "重启服务" },
  { key: "health", title: "健康探活" },
];

function phaseToStep(phase: Phase): number {
  const idx = PHASE_STEPS.findIndex((s) => s.key === phase);
  if (idx >= 0) return idx;
  if (phase === "done") return PHASE_STEPS.length;
  return 0;
}

function fmtBytes(n: number): string {
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m${sec % 60}s`;
  return `${Math.floor(sec / 3600)}h${Math.floor((sec % 3600) / 60)}m`;
}

export default function SystemUpgrade() {
  const { isAdmin } = useAuth();
  const [current, setCurrent] = useState<Awaited<ReturnType<typeof api.upgradeCurrent>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [stagingId, setStagingId] = useState<string | null>(null);
  const [stagingFile, setStagingFile] = useState<{ name: string; size: number } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [report, setReport] = useState<Awaited<ReturnType<typeof api.upgradeAnalyze>> | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.upgradeStatus>> | null>(null);
  const [history, setHistory] = useState<Awaited<ReturnType<typeof api.upgradeHistory>>>([]);
  const [confirm1, setConfirm1] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const pollTimer = useRef<number | null>(null);

  const fetchCurrent = async () => {
    setLoading(true);
    try {
      const r = await api.upgradeCurrent();
      setCurrent(r);
    } catch (e: any) {
      message.error(e.message || "获取版本信息失败");
    } finally {
      setLoading(false);
    }
  };

  const fetchHistory = async () => {
    try {
      setHistory(await api.upgradeHistory());
    } catch (e: any) {
      // silent
    }
  };

  const pollStatus = async () => {
    try {
      const s = await api.upgradeStatus();
      setStatus(s);
      if (s.jobId) setActiveJobId(s.jobId);
      if (s.phase === "done" || s.phase === "failed" || s.phase === "rolled-back") {
        // 停止轮询
        if (pollTimer.current) {
          window.clearInterval(pollTimer.current);
          pollTimer.current = null;
        }
        await fetchHistory();
        await fetchCurrent();
      }
    } catch {
      // silent
    }
  };

  useEffect(() => {
    if (!isAdmin) return;
    fetchCurrent();
    fetchHistory();
    pollStatus();
    return () => {
      if (pollTimer.current) window.clearInterval(pollTimer.current);
    };
  }, [isAdmin]);

  if (!isAdmin) {
    return (
      <Card>
        <Alert type="warning" showIcon message="系统升级仅管理员可用" />
      </Card>
    );
  }

  const beforeUpload = async (file: File) => {
    if (!/\.(tar\.gz|tgz)$/i.test(file.name)) {
      message.error("仅支持 .tar.gz / .tgz 升级包");
      return false;
    }
    if (file.size > 100 * 1024 * 1024) {
      message.error("升级包不能超过 100MB");
      return false;
    }
    setUploading(true);
    try {
      const r = await api.upgradeUpload(file);
      setStagingId(r.stagingId);
      setStagingFile({ name: r.name, size: r.size });
      message.success(`已上传:${r.name}`);
      // 自动 analyze
      setAnalyzing(true);
      try {
        const rep = await api.upgradeAnalyze(r.stagingId);
        setReport(rep);
        setReportOpen(true);
      } catch (e: any) {
        message.error(`分析失败:${e.message}`);
      } finally {
        setAnalyzing(false);
      }
    } catch (e: any) {
      message.error(`上传失败:${e.message}`);
    } finally {
      setUploading(false);
    }
    return false; // 阻止默认上传
  };

  const startUpgrade = async () => {
    if (!stagingId) return;
    Modal.confirm({
      title: "确认执行系统升级",
      icon: <WarningOutlined style={{ color: "#faad14" }} />,
      content: (
        <div>
          <Paragraph>升级将依次执行:备份 → 解包 → Schema 合并 → 密钥检查 → 代码替换 → 重启 → 健康检查。</Paragraph>
          <Paragraph>
            <Text strong type="danger">
              过程中服务会重启,可能短暂不可用(约 30 秒)。
            </Text>
          </Paragraph>
        </div>
      ),
      okText: "确认升级",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: async () => {
        setApplying(true);
        try {
          const r = await api.upgradeApply(stagingId);
          setActiveJobId(r.jobId);
          message.success(`升级任务已启动 jobId=${r.jobId.slice(0, 8)}`);
          // 启轮询
          if (pollTimer.current) window.clearInterval(pollTimer.current);
          pollTimer.current = window.setInterval(() => pollStatus(), 1500);
          await pollStatus();
        } catch (e: any) {
          message.error(`启动失败:${e.message}`);
        } finally {
          setApplying(false);
        }
      },
    });
  };

  const doRollback = async () => {
    Modal.confirm({
      title: "确认回滚到上次备份?",
      content: "回滚将恢复 config/ + SQLite + overlay 到升级前状态,并重启服务。",
      okText: "回滚",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const r = await api.upgradeRollback();
          message.success(`回滚已启动 jobId=${r.jobId.slice(0, 8)}`);
          setActiveJobId(r.jobId);
          if (pollTimer.current) window.clearInterval(pollTimer.current);
          pollTimer.current = window.setInterval(() => pollStatus(), 1500);
        } catch (e: any) {
          message.error(`回滚失败:${e.message}`);
        }
      },
    });
  };

  const confirmEnabled = confirm1 && confirmText.trim() === "UPGRADE";
  const isRunning = status?.phase && !["idle", "done", "failed", "rolled-back"].includes(status.phase);

  const phaseColor =
    status?.phase === "done"
      ? "success"
      : status?.phase === "failed"
        ? "error"
        : status?.phase === "rolled-back"
          ? "warning"
          : "active";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          系统升级
        </Title>
        <Space>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => {
              fetchCurrent();
              fetchHistory();
              pollStatus();
            }}
          >
            刷新
          </Button>
        </Space>
      </div>

      <Card style={{ marginBottom: 16 }} loading={loading} title="当前版本">
        {current && (
          <Row gutter={16}>
            <Col span={6}>
              <Statistic title="版本" value={current.readableVersion} />
            </Col>
            <Col span={6}>
              <Statistic title="运行时长" value={fmtDuration(current.uptimeSec)} />
            </Col>
            <Col span={6}>
              <Statistic title="数据库" value={fmtBytes(current.dbBytes)} />
            </Col>
            <Col span={6}>
              <Statistic title="用户字段数" value={current.userFieldCount} suffix="个" />
            </Col>
          </Row>
        )}
      </Card>

      <Card style={{ marginBottom: 16 }} title="① 选择升级源">
        <Dragger
          name="file"
          accept=".tar.gz,.tgz"
          multiple={false}
          showUploadList={false}
          beforeUpload={beforeUpload}
          disabled={uploading || analyzing || isRunning === true}
          data-testid="upgrade-upload"
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">点击或拖入升级包(.tar.gz)</p>
          <p className="ant-upload-hint">最大 100MB;上传后自动分析,产出 diff 报告供确认。</p>
        </Dragger>
        {stagingFile && (
          <Alert
            style={{ marginTop: 12 }}
            type="info"
            showIcon
            message={`已选:${stagingFile.name} (${fmtBytes(stagingFile.size)})`}
          />
        )}
      </Card>

      <Card style={{ marginBottom: 16 }} title="② 分析报告">
        {analyzing ? (
          <Paragraph>分析中...</Paragraph>
        ) : !report ? (
          <Empty description="尚未上传升级包" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <>
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="目标版本">{report.targetVersion}</Descriptions.Item>
              <Descriptions.Item label="新增 schema">{report.newSchemas.length} 个</Descriptions.Item>
              <Descriptions.Item label="保留 user 字段">{report.schemaReport.kept.length}</Descriptions.Item>
              <Descriptions.Item label="字段冲突">
                {report.schemaReport.conflicts.length > 0 ? (
                  <Tag color="orange">{report.schemaReport.conflicts.length} 处需确认</Tag>
                ) : (
                  <Tag color="green">无</Tag>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="必填环境变量" span={2}>
                {report.requiredEnv.join(", ")}
              </Descriptions.Item>
            </Descriptions>
            {report.breaking.length > 0 && (
              <Alert
                style={{ marginTop: 12 }}
                type="error"
                showIcon
                message="检测到 breaking changes"
                description={
                  <ul style={{ marginBottom: 0 }}>
                    {report.breaking.map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                }
              />
            )}
            {report.warnings.length > 0 && (
              <Alert
                style={{ marginTop: 12 }}
                type="warning"
                showIcon
                message="警告"
                description={
                  <ul style={{ marginBottom: 0 }}>
                    {report.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                }
              />
            )}
            <Space style={{ marginTop: 12 }}>
              <Button icon={<FileSearchOutlined />} onClick={() => setReportOpen(true)}>
                查看完整 diff
              </Button>
            </Space>
          </>
        )}
      </Card>

      <Card style={{ marginBottom: 16 }} title="③ 执行升级">
        {isRunning ? (
          <div>
            <Steps
              current={phaseToStep(status?.phase as Phase)}
              size="small"
              status={phaseColor as any}
              items={PHASE_STEPS.map((s) => ({ title: s.title }))}
            />
            <Progress percent={status?.percent ?? 0} style={{ marginTop: 16 }} />
            <Alert
              style={{ marginTop: 12 }}
              type="info"
              showIcon
              message={`当前阶段:${status?.phase}`}
              description={status?.error ?? "正在执行,请勿关闭页面"}
            />
            {activeJobId && (
              <div style={{ marginTop: 12 }}>
                <Text type="secondary">jobId: {activeJobId}</Text>
              </div>
            )}
            {status?.log && status.log.length > 0 && (
              <div
                style={{
                  marginTop: 12,
                  maxHeight: 200,
                  overflow: "auto",
                  background: "#1e1e1e",
                  color: "#0f0",
                  padding: 8,
                  fontFamily: "monospace",
                  fontSize: 12,
                }}
              >
                {status.log.slice(-30).map((l, i) => (
                  <div key={i}>{l}</div>
                ))}
              </div>
            )}
          </div>
        ) : status?.phase === "done" ? (
          <Alert
            type="success"
            showIcon
            message="升级完成"
            description={`从 ${status.fromVersion ?? "?"} 升级到 ${status.targetVersion ?? report?.targetVersion ?? "?"}`}
          />
        ) : status?.phase === "failed" || status?.phase === "rolled-back" ? (
          <>
            <Alert
              type={status?.phase === "failed" ? "error" : "warning"}
              showIcon
              message={status?.phase === "failed" ? "升级失败" : "已回滚"}
              description={status?.error ?? ""}
            />
            {status?.backupId && (
              <Button
                style={{ marginTop: 12 }}
                danger
                icon={<RollbackOutlined />}
                onClick={doRollback}
                data-testid="upgrade-rollback"
              >
                回滚到 {status.backupId}
              </Button>
            )}
          </>
        ) : (
          <>
            <Checkbox
              checked={confirm1}
              onChange={(e) => setConfirm1(e.target.checked)}
              data-testid="upgrade-confirm-checkbox"
            >
              我已审阅 diff 报告并完成必要的备份/通知
            </Checkbox>
            <div style={{ marginTop: 12 }}>
              <Text>请输入 </Text>
              <Text code>UPGRADE</Text>
              <Text> 以解锁执行按钮:</Text>
              <Input
                style={{ width: 200, marginLeft: 8 }}
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="UPGRADE"
                data-testid="upgrade-confirm-text"
              />
            </div>
            <Button
              type="primary"
              danger
              icon={<PlayCircleOutlined />}
              disabled={!stagingId || !report || !confirmEnabled || applying}
              loading={applying}
              onClick={startUpgrade}
              style={{ marginTop: 16 }}
              data-testid="upgrade-apply-btn"
            >
              执行升级
            </Button>
            {status?.backupId && (
              <Button style={{ marginTop: 16, marginLeft: 8 }} icon={<RollbackOutlined />} onClick={doRollback}>
                回滚到 {status.backupId}
              </Button>
            )}
          </>
        )}
      </Card>

      <Card title="升级历史">
        <Table
          rowKey="jobId"
          dataSource={history}
          size="small"
          pagination={false}
          locale={{ emptyText: <Empty description="暂无升级记录" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
          columns={[
            { title: "时间", dataIndex: "endedAt", width: 180 },
            { title: "从", dataIndex: "fromVersion", width: 180 },
            { title: "到", dataIndex: "toVersion", width: 180 },
            {
              title: "阶段",
              dataIndex: "phase",
              width: 120,
              render: (p: string) => (
                <Tag color={p === "done" ? "green" : p === "rolled-back" ? "orange" : "red"}>{p}</Tag>
              ),
            },
            { title: "backupId", dataIndex: "backupId", ellipsis: true },
          ]}
        />
      </Card>

      <Drawer title="升级分析 — 完整 diff" open={reportOpen} onClose={() => setReportOpen(false)} width={720}>
        {report && (
          <Tabs
            defaultActiveKey="schema"
            items={[
              {
                key: "schema",
                label: `Schema (${report.schemaReport.kept.length + report.schemaReport.conflicts.length})`,
                children: (
                  <>
                    {report.schemaReport.conflicts.length > 0 && (
                      <>
                        <Title level={5}>字段冲突 ({report.schemaReport.conflicts.length})</Title>
                        <Table
                          rowKey={(r) => `${r.nodeType}#${r.fieldName}`}
                          dataSource={report.schemaReport.conflicts}
                          size="small"
                          pagination={false}
                          columns={[
                            { title: "表", dataIndex: "nodeType" },
                            { title: "字段", dataIndex: "fieldName" },
                            { title: "user 类型", dataIndex: "userType" },
                            { title: "baseline 类型", dataIndex: "baselineType" },
                            { title: "建议", dataIndex: "suggestion" },
                          ]}
                        />
                      </>
                    )}
                    <Title level={5} style={{ marginTop: 16 }}>
                      保留的用户字段 ({report.schemaReport.kept.length})
                    </Title>
                    <Table
                      rowKey={(r) => `${r.nodeType}#${r.fieldName}`}
                      dataSource={report.schemaReport.kept}
                      size="small"
                      pagination={{ pageSize: 10 }}
                      columns={[
                        { title: "表", dataIndex: "nodeType" },
                        { title: "字段", dataIndex: "fieldName" },
                      ]}
                    />
                    <Title level={5} style={{ marginTop: 16 }}>
                      用户自建表 ({report.schemaReport.userTables.length})
                    </Title>
                    <Table
                      rowKey="nodeType"
                      dataSource={report.schemaReport.userTables}
                      size="small"
                      pagination={false}
                      columns={[
                        { title: "nodeType", dataIndex: "nodeType" },
                        { title: "字段数", dataIndex: "fieldCount", width: 100 },
                      ]}
                    />
                  </>
                ),
              },
              {
                key: "new",
                label: `新增 schema (${report.newSchemas.length})`,
                children: (
                  <Table
                    rowKey="nodeType"
                    dataSource={report.newSchemas.map((x) => ({ key: x, nodeType: x }))}
                    size="small"
                    pagination={false}
                    columns={[{ title: "nodeType", dataIndex: "nodeType" }]}
                  />
                ),
              },
              {
                key: "env",
                label: "环境与警告",
                children: (
                  <Descriptions bordered column={1} size="small">
                    <Descriptions.Item label="必填 env">{report.requiredEnv.join(", ")}</Descriptions.Item>
                    <Descriptions.Item label="breaking">
                      {report.breaking.length === 0 ? "无" : report.breaking.join("; ")}
                    </Descriptions.Item>
                    <Descriptions.Item label="warnings">
                      {report.warnings.length === 0 ? "无" : report.warnings.join("; ")}
                    </Descriptions.Item>
                  </Descriptions>
                ),
              },
            ]}
          />
        )}
      </Drawer>
    </div>
  );
}
