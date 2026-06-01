import { useEffect, useState } from "react";
import {
  Typography,
  Card,
  Form,
  Input,
  InputNumber,
  Button,
  Select,
  Space,
  Skeleton,
  message,
  Alert,
  AutoComplete,
  Tooltip,
} from "antd";
import { ThunderboltOutlined, SaveOutlined, ApiOutlined, ReloadOutlined } from "@ant-design/icons";
import { api } from "../api.js";
import type { LlmSettingsMaskedDTO, LlmSettingsPutBody, LlmThinkingMode } from "../api.js";
import HelpButton from "../components/HelpButton.js";
import HELP from "../help-content.js";
import { handleApiError } from "../utils/handleApiError.js";

const { Title, Text } = Typography;

// 各 provider 的默认 baseURL / model 速查表
interface ProviderDefault {
  baseUrl: string;
  defaultModel: string;
  smallModel?: string;
  label: string;
  models?: string[]; // 常用模型下拉提示
}

const PROVIDER_DEFAULTS: Record<string, ProviderDefault> = {
  "zhipuai-coding-plan": {
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4-flash",
    smallModel: "glm-4-flash",
    label: "智谱 AI(zhipuai-coding-plan)",
    // §v2.3.5: glm-4-flash 排第一(免费可用,无需余额);其余按 v2.3.4 教训保留
    models: ["glm-4-flash", "glm-4.5-air", "glm-4.5-flash", "glm-4.5", "glm-4-plus", "glm-4.6", "glm-4-air"],
  },
  huawei_cloud: {
    baseUrl: "https://api.modelarts-maas.com/openai/v1",
    defaultModel: "glm-5",
    smallModel: "glm-5",
    label: "华为云 ModelArts(huawei_cloud)",
    models: ["glm-5", "qwen3-coder-480b-a35b-instruct", "qwen3-235b-a22b", "Kimi-K2.6"],
  },
  custom: {
    baseUrl: "",
    defaultModel: "",
    smallModel: "",
    label: "自定义 OpenAI 兼容(custom)",
  },
};

interface FormValues {
  provider: string;
  baseUrl: string;
  apiKey?: string;
  defaultModel: string;
  smallModel?: string;
  thinking: LlmThinkingMode;
  maxHops: number;
  timeoutMs: number;
}

export default function LlmSettings() {
  const [config, setConfig] = useState<LlmSettingsMaskedDTO | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  // §v2.3.5: 动态 provider 模型列表(刷新按钮加载),null 表示未刷新过,走 PROVIDER_DEFAULTS.models fallback
  const [dynamicModels, setDynamicModels] = useState<string[] | null>(null);
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [form] = Form.useForm<FormValues>();

  const fetchConfig = async () => {
    try {
      const c = await api.getLlmSettings();
      setConfig(c);
      form.setFieldsValue({
        provider: c.provider || "zhipuai-coding-plan",
        baseUrl: c.baseUrl || PROVIDER_DEFAULTS["zhipuai-coding-plan"].baseUrl,
        // §v2.3.5: 默认 glm-4-flash(免费可用)
        defaultModel: c.defaultModel || PROVIDER_DEFAULTS["zhipuai-coding-plan"].defaultModel,
        smallModel: c.smallModel || PROVIDER_DEFAULTS["zhipuai-coding-plan"].smallModel || "",
        thinking: c.thinking || "disabled",
        maxHops: c.maxHops || 6,
        timeoutMs: c.timeoutMs || 60000,
        apiKey: "",
      });
    } catch (e) {
      handleApiError(e, "加载 LLM 配置失败");
    } finally {
      setInitialLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleProviderChange = (provider: string) => {
    const d = PROVIDER_DEFAULTS[provider];
    if (!d) return;
    const cur = form.getFieldsValue();
    form.setFieldsValue({
      provider,
      baseUrl: d.baseUrl || cur.baseUrl,
      defaultModel: d.defaultModel || cur.defaultModel,
      smallModel: d.smallModel || cur.smallModel,
    });
  };

  const onSave = async () => {
    try {
      const v = await form.validateFields();
      setSaving(true);
      const body: LlmSettingsPutBody = {
        provider: v.provider,
        baseUrl: v.baseUrl,
        defaultModel: v.defaultModel,
        smallModel: v.smallModel,
        thinking: v.thinking,
        maxHops: v.maxHops,
        timeoutMs: v.timeoutMs,
      };
      if (v.apiKey && v.apiKey.length > 0) body.apiKey = v.apiKey;
      const updated = await api.putLlmSettings(body);
      setConfig(updated);
      form.setFieldsValue({ apiKey: "" });
      message.success("保存成功");
    } catch (e: unknown) {
      if (e && typeof e === "object" && "errorFields" in e) return; // form validate error
      handleApiError(e, "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const onRefreshModels = async () => {
    setRefreshingModels(true);
    try {
      const r = await api.listLlmModels();
      if (r.models && r.models.length > 0) {
        setDynamicModels(r.models.map((m) => m.id));
        message.success(`已刷新 ${r.models.length} 个模型`);
      } else if (r.error) {
        message.warning(`刷新失败:${r.error}(降级使用内置模型列表)`);
      } else {
        message.warning("provider 返回空列表(降级使用内置模型列表)");
      }
    } catch (e) {
      handleApiError(e, "刷新模型列表失败");
    } finally {
      setRefreshingModels(false);
    }
  };

  const onTest = async () => {
    try {
      const v = form.getFieldsValue();
      setTesting(true);
      const r = await api.testLlmSettings({
        model: v.defaultModel,
        thinking: v.thinking,
        baseUrl: v.baseUrl,
        // apiKey 留空 → 走 DB(后端已存的);用户在 form 里输了新的就用新的
        apiKey: v.apiKey || undefined,
      });
      if (r.ok) {
        message.success(`连接成功 (${r.latencyMs ?? "?"}ms${r.modelEcho ? " · " + r.modelEcho : ""})`);
      } else {
        message.error(`连接失败:${r.error ?? "未知错误"}`);
      }
    } catch (e) {
      handleApiError(e, "测试失败");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>
          <ThunderboltOutlined /> LLM 设置
        </Title>
        <Space>
          <Button icon={<ApiOutlined />} onClick={onTest} loading={testing} disabled={initialLoading}>
            测试连接
          </Button>
          <Button type="primary" icon={<SaveOutlined />} onClick={onSave} loading={saving} disabled={initialLoading}>
            保存
          </Button>
          <HelpButton title={HELP.llmSettings.title} content={HELP.llmSettings.content} />
        </Space>
      </div>

      <Alert
        showIcon
        type="info"
        style={{ marginBottom: 16 }}
        message="保存后立即对全站 Hermes 问答生效,无需重启后端。apiKey 在 DB 内以 AES-256-GCM 加密存储,前端永远只显示掩码(****后4位)。"
      />

      {initialLoading ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : (
        <Card>
          <Form form={form} layout="vertical">
            <Form.Item label="Provider 提供商" name="provider" rules={[{ required: true, message: "请选择 provider" }]}>
              <Select onChange={handleProviderChange}>
                {Object.entries(PROVIDER_DEFAULTS).map(([k, d]) => (
                  <Select.Option key={k} value={k}>
                    {d.label}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>

            <Form.Item
              label="baseURL"
              name="baseUrl"
              rules={[{ required: true, message: "请填写 baseURL" }]}
              extra="OpenAI 兼容的 chat/completions 根路径(不含 /chat/completions 后缀)"
            >
              <Input placeholder="https://open.bigmodel.cn/api/paas/v4" />
            </Form.Item>

            <Form.Item
              label={`apiKey ${config?.apiKeyMasked ? "(当前:" + config.apiKeyMasked + ")" : "(未设置)"}`}
              name="apiKey"
              extra="留空表示保留旧 apiKey,不修改。粘贴新值则覆盖。"
            >
              <Input.Password autoComplete="off" placeholder="不修改请留空" />
            </Form.Item>

            <Form.Item shouldUpdate={(p, c) => p.provider !== c.provider} noStyle>
              {({ getFieldValue }) => {
                const providerModels = PROVIDER_DEFAULTS[getFieldValue("provider") as string]?.models;
                // §v2.3.5: 优先用动态列表(刷新后注入);否则降级到 PROVIDER_DEFAULTS.models;再否则空
                const modelList = dynamicModels && dynamicModels.length > 0 ? dynamicModels : providerModels;
                const options = modelList ? modelList.map((m) => ({ value: m, label: m })) : [];
                const refreshBtn = (
                  <Tooltip title="点击调 provider /models endpoint 拉取真实可用模型列表(失败时降级为内置列表)">
                    <Button icon={<ReloadOutlined />} size="small" onClick={onRefreshModels} loading={refreshingModels}>
                      刷新模型列表
                    </Button>
                  </Tooltip>
                );
                return (
                  <>
                    <Form.Item
                      label={
                        <Space>
                          <span>defaultModel 主模型</span>
                          {refreshBtn}
                        </Space>
                      }
                      name="defaultModel"
                      rules={[{ required: true, message: "请填写 defaultModel" }]}
                      extra={
                        dynamicModels && dynamicModels.length > 0
                          ? `已从 provider 拉取 ${dynamicModels.length} 个真实模型(支持输入任意模型名)`
                          : modelList
                            ? `常用:${modelList.slice(0, 4).join(" / ")}…(支持输入任意模型名,点上方按钮刷新真实列表)`
                            : "支持输入任意模型名"
                      }
                    >
                      {dynamicModels && dynamicModels.length > 0 ? (
                        <Select
                          showSearch
                          allowClear
                          options={options}
                          placeholder="glm-4-flash"
                          filterOption={(input, option) =>
                            String(option?.label ?? option?.value ?? "")
                              .toLowerCase()
                              .includes(input.toLowerCase())
                          }
                        />
                      ) : (
                        <AutoComplete options={options} placeholder="glm-4-flash" />
                      )}
                    </Form.Item>

                    <Form.Item label="smallModel 小模型(可选,用于轻量任务)" name="smallModel">
                      {dynamicModels && dynamicModels.length > 0 ? (
                        <Select
                          showSearch
                          allowClear
                          options={options}
                          placeholder="glm-4-flash"
                          filterOption={(input, option) =>
                            String(option?.label ?? option?.value ?? "")
                              .toLowerCase()
                              .includes(input.toLowerCase())
                          }
                        />
                      ) : (
                        <AutoComplete options={options} placeholder="glm-4-flash" allowClear />
                      )}
                    </Form.Item>
                  </>
                );
              }}
            </Form.Item>

            <Form.Item
              label="thinking 思考模式"
              name="thinking"
              extra="disabled=禁用思考(最快);enabled=强制思考(更准);auto=由 provider 决定"
            >
              <Select>
                <Select.Option value="disabled">disabled(禁用)</Select.Option>
                <Select.Option value="enabled">enabled(启用)</Select.Option>
                <Select.Option value="auto">auto(自动)</Select.Option>
              </Select>
            </Form.Item>

            <Form.Item label="maxHops 工具最大轮数" name="maxHops" rules={[{ required: true }]}>
              <InputNumber min={1} max={12} style={{ width: 120 }} />
            </Form.Item>

            <Form.Item label="timeoutMs 单次超时(ms)" name="timeoutMs" rules={[{ required: true }]}>
              <InputNumber min={5000} max={300000} step={1000} style={{ width: 160 }} />
            </Form.Item>

            {config?.updatedAt ? (
              <Text type="secondary">
                上次保存:{config.updatedAt}
                {config.updatedBy ? ` · ${config.updatedBy}` : ""}
              </Text>
            ) : null}
          </Form>
        </Card>
      )}
    </div>
  );
}
