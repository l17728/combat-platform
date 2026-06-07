import { useEffect, useState, useCallback } from "react";
import {
  Typography,
  Table,
  Button,
  Space,
  Modal,
  Form,
  Input,
  message,
  Popconfirm,
  Tag,
  Empty,
  Skeleton,
  Spin,
} from "antd";
import { PlusOutlined, ReloadOutlined, PlayCircleOutlined, DeleteOutlined } from "@ant-design/icons";
import { api } from "../api.js";
import { useGuestGuard } from "../hooks/useGuestGuard.js";
import { PAGE_SIZE, PAGE_SIZE_OPTIONS } from "../constants.js";
import HelpButton from "../components/HelpButton.js";
import HELP from "../help-content.js";
import { handleApiError } from "../utils/handleApiError.js";
import type { CustomCommand, CustomCommandRunResult } from "@combat/shared";

const { Title, Text } = Typography;

function extractParams(template: string): string[] {
  const out: string[] = [];
  for (const m of template.matchAll(/\{([^}]+)\}/g)) {
    const p = m[1].trim();
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}

export default function CustomCommands() {
  const [commands, setCommands] = useState<CustomCommand[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [runCmd, setRunCmd] = useState<CustomCommand | null>(null);
  const [runForm] = Form.useForm();
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<CustomCommandRunResult | null>(null);
  const [detectedParams, setDetectedParams] = useState<string[]>([]);
  const { guard } = useGuestGuard();

  const fetchCommands = useCallback(async () => {
    setLoading(true);
    try {
      setCommands(await api.listCommands());
    } catch (e) {
      handleApiError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCommands();
  }, [fetchCommands]);

  const handleAdd = async (values: { name: string; template: string; description?: string }) => {
    if (!guard()) return;
    setSubmitting(true);
    try {
      await api.createCommand(values);
      message.success("命令已创建");
      setAddOpen(false);
      addForm.resetFields();
      setDetectedParams([]);
      fetchCommands();
    } catch (e) {
      handleApiError(e);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!guard()) return;
    try {
      await api.deleteCommand(id);
      message.success("已删除");
      fetchCommands();
    } catch (e) {
      handleApiError(e);
    }
  };

  const handleRun = async (values: Record<string, string>) => {
    if (!runCmd) return;
    setRunning(true);
    setRunResult(null);
    try {
      const result = await api.runCommand(runCmd.id, values);
      setRunResult(result);
    } catch (e) {
      handleApiError(e);
    } finally {
      setRunning(false);
    }
  };

  const openRunModal = (cmd: CustomCommand) => {
    setRunCmd(cmd);
    setRunResult(null);
    runForm.resetFields();
    setRunOpen(true);
  };

  const handleTemplateChange = (template: string) => {
    setDetectedParams(extractParams(template));
  };

  const columns = [
    {
      title: "名称",
      dataIndex: "name",
      width: 160,
      render: (v: string, r: CustomCommand) => (
        <div>
          <Text strong>{v}</Text>
          {r.description && (
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {r.description}
              </Text>
            </div>
          )}
        </div>
      ),
    },
    {
      title: "模板",
      dataIndex: "template",
      render: (v: string) => <Text code>{v}</Text>,
    },
    {
      title: "参数",
      dataIndex: "params",
      width: 200,
      render: (params: string[]) =>
        params.length > 0 ? (
          <Space size={[4, 4]} wrap>
            {params.map((p) => (
              <Tag key={p}>{p}</Tag>
            ))}
          </Space>
        ) : (
          <Text type="secondary">无参数</Text>
        ),
    },
    {
      title: "操作",
      key: "ops",
      width: 160,
      fixed: "right" as const,
      render: (_: unknown, r: CustomCommand) => (
        <Space>
          <a onClick={() => openRunModal(r)}>
            <PlayCircleOutlined /> 执行
          </a>
          <Popconfirm title={`确认删除命令「${r.name}」？`} onConfirm={() => handleDelete(r.id)}>
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
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <Space>
          <Title level={4} style={{ margin: 0 }}>
            自定义命令
          </Title>
          <HelpButton title={HELP.customCommands?.title ?? "自定义命令"} content={HELP.customCommands?.content ?? ""} />
        </Space>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetchCommands}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => guard() && setAddOpen(true)}>
            新建命令
          </Button>
        </Space>
      </div>

      <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
        自定义命令是系统内置 CLI 的快捷模板。模板中使用 {"{参数名}"} 作为占位符，执行时填入实际值。
      </Text>

      {loading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : commands.length === 0 ? (
        <Empty description="暂无自定义命令">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => guard() && setAddOpen(true)}>
            新建命令
          </Button>
        </Empty>
      ) : (
        <Table
          rowKey="id"
          dataSource={commands}
          columns={columns}
          pagination={{
            pageSize: PAGE_SIZE,
            showSizeChanger: true,
            pageSizeOptions: PAGE_SIZE_OPTIONS,
            showTotal: (t) => `共 ${t} 条`,
          }}
          size="middle"
        />
      )}

      <Modal
        title="新建命令"
        open={addOpen}
        onCancel={() => {
          setAddOpen(false);
          addForm.resetFields();
          setDetectedParams([]);
        }}
        footer={null}
        destroyOnClose
      >
        <Form form={addForm} layout="vertical" onFinish={handleAdd}>
          <Form.Item name="name" label="命令名称" rules={[{ required: true, message: "请输入名称" }]}>
            <Input placeholder="如：导出周报" />
          </Form.Item>
          <Form.Item name="description" label="描述（可选）">
            <Input placeholder="命令功能说明" />
          </Form.Item>
          <Form.Item
            name="template"
            label="命令模板"
            rules={[{ required: true, message: "请输入模板" }]}
            extra={
              detectedParams.length > 0 ? (
                <span>
                  检测到参数：
                  {detectedParams.map((p) => (
                    <Tag key={p} style={{ marginLeft: 4 }}>
                      {p}
                    </Tag>
                  ))}
                </span>
              ) : null
            }
          >
            <Input.TextArea
              rows={3}
              placeholder="如: report:weekly {week}"
              onChange={(e) => handleTemplateChange(e.target.value)}
            />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0, textAlign: "right" }}>
            <Space>
              <Button
                onClick={() => {
                  setAddOpen(false);
                  addForm.resetFields();
                  setDetectedParams([]);
                }}
              >
                取消
              </Button>
              <Button type="primary" htmlType="submit" loading={submitting}>
                创建
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`执行命令：${runCmd?.name ?? ""}`}
        open={runOpen}
        onCancel={() => {
          setRunOpen(false);
          setRunResult(null);
        }}
        footer={null}
        destroyOnClose
        width={560}
      >
        {runCmd && (
          <>
            <Form form={runForm} layout="vertical" onFinish={handleRun}>
              {runCmd.params.map((p) => (
                <Form.Item key={p} name={p} label={p} rules={[{ required: true, message: `请输入 ${p}` }]}>
                  <Input placeholder={`输入 ${p} 的值`} />
                </Form.Item>
              ))}
              <Form.Item style={{ marginBottom: 0, textAlign: "right" }}>
                <Space>
                  <Button onClick={() => setRunOpen(false)}>取消</Button>
                  <Button type="primary" htmlType="submit" loading={running} icon={<PlayCircleOutlined />}>
                    执行
                  </Button>
                </Space>
              </Form.Item>
            </Form>
            {runResult && (
              <div style={{ marginTop: 16, padding: 12, background: "#f5f5f5", borderRadius: 6 }}>
                <Text strong>解析结果：</Text>
                <Text code>{runResult.resolved}</Text>
                <div style={{ marginTop: 8 }}>
                  <Text strong>请求：</Text>
                  <pre style={{ fontSize: 12, margin: "4px 0 0", maxHeight: 200, overflow: "auto" }}>
                    {JSON.stringify(runResult.request, null, 2)}
                  </pre>
                </div>
              </div>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}
