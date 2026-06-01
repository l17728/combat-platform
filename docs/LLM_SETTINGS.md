# LLM 配置 (v2.3.4)

> v2.3.4 起,Hermes 智能问答所用的 LLM 全部从前端 UI 管理。无需登录服务器改 env、改配置文件,
> 也无需重启 backend — 保存即生效。本文档面向 admin / 运维。

## 入口

- **UI**: 系统管理 → 「LLM 设置」(`/llm-settings`,仅 admin 可见可访问)
- **CLI**: `npm run cli -- llm:get | llm:set | llm:test`
- **API**: `GET/PUT /api/llm-settings`、`POST /api/llm-settings/test` (均限 admin)

## 字段说明

| 字段           | 类型         | 必填 | 说明                                                                                   |
| -------------- | ------------ | ---- | -------------------------------------------------------------------------------------- |
| `provider`     | string       | 是   | `zhipuai-coding-plan` / `huawei_cloud` / `custom`,选中后 UI 自动回填默认 baseURL/model |
| `baseUrl`      | string (URL) | 是   | OpenAI 兼容的根路径(不带 `/chat/completions` 后缀)                                     |
| `apiKey`       | string       | 首次 | UI 输入框留空 = 保留旧值不修改;非空才覆盖。**永远不返回明文**                          |
| `defaultModel` | string       | 是   | 主推理 model 名,例 `glm-4.6` / `glm-5` / `gpt-4o`                                      |
| `smallModel`   | string       | 否   | 备用轻量 model,当前未使用,可填可不填                                                   |
| `thinking`     | enum         | 否   | `disabled` / `enabled` / `auto`,默认 `disabled`。映射到请求 body `thinking.type` 字段  |
| `maxHops`      | int (1-12)   | 否   | LLM 多轮工具调用硬上限,默认 6                                                          |
| `timeoutMs`    | int (5000+)  | 否   | 单次 LLM 调用超时(毫秒),默认 60000                                                     |

## 配置来源优先级

OpenAICompatibleRunner 每次调用前按下列顺序拼装最终 config:

1. **DB**(`llm_settings` 表)— UI/CLI/PUT 路径写入,实时生效
2. **env** — `HERMES_LLM_BASE_URL` / `HERMES_LLM_API_KEY` / `HERMES_MODEL`
3. **硬编码默认** — baseURL 默认智谱、model 默认 `glm-4.6`、thinking 默认 `disabled`;**apiKey 没有 hardcoded fallback**

启动时会输出一条日志记录最终配置来源:

```
[INFO] llm.runner.config provider=zhipuai-coding-plan baseURL=https://open.bigmodel.cn/api/paas/v4 model=glm-4.6 thinking=disabled source=db
```

`source` 为 `db` / `env` / `default` 之一。

## 安全模型

- **加密存储**: apiKey 在 DB 内以 AES-256-GCM 加密(`crypto.ts::encrypt`),根密钥派生自 `COMBAT_CRYPTO_KEY` env(默认派生于 JWT_SECRET)
- **掩码返回**: `GET /api/llm-settings` 响应 / 审计日志 / 结构化日志中,apiKey 一律呈现为 `****` + 后 4 位
- **admin 限制**: 三个端点 + `/llm-settings` 路由均挂 `adminMiddleware`;非 admin 用户在前端被 `<AdminGuard>` 重定向到首页
- **不写日志**: Bearer header 之外的任何位置都不会出现明文 apiKey;`hermes.llm.chat` 日志只含 model / messages 数 / 工具数 / hasContent / toolCalls 数
- **审计**: 每次 PUT 写入 `llm_settings.put` 结构化日志(provider/baseUrl/defaultModel/thinking/updatedBy)

## 操作流程

### 首次配置

1. 用 admin 账号登录前端
2. 左侧「系统管理 → LLM 设置」
3. 选 provider(智谱 / 华为云 / 自定义)→ UI 自动填默认 baseURL+model
4. 粘贴 apiKey
5. 点「测试连接」→ 200ms 内返回 latencyMs / modelEcho 即正常
6. 点「保存」→ 全站 Hermes 立即用新配置

### 切换 provider / model

1. 进入 UI,选另一个 provider 或手改 defaultModel
2. 「测试连接」确认通过
3. 「保存」
4. (可选)随便问一条 Hermes 验证

### 轮换 apiKey

1. 进入 UI(apiKey 输入框 placeholder 显示当前掩码 `****cdef`)
2. 在 apiKey 框粘贴新 key
3. 测试连接 → 保存
4. 老 key 已不再保存于 DB,可在 provider 控制台吊销

### CLI 批量化

```bash
# 查看(掩码)
npm run cli -- llm:get

# 全量保存
npm run cli -- llm:set \
  --provider zhipuai-coding-plan \
  --base-url https://open.bigmodel.cn/api/paas/v4 \
  --api-key $LLM_KEY \
  --model glm-4.6 \
  --small-model glm-4.5-air \
  --thinking disabled \
  --max-hops 6 \
  --timeout-ms 60000

# 只换 model
npm run cli -- llm:set --provider zhipuai-coding-plan --base-url https://open.bigmodel.cn/api/paas/v4 --model glm-4.5-air
# (不传 --api-key 时 backend 保留旧值)

# 测试
npm run cli -- llm:test --model glm-4.6 --thinking disabled
```

## 故障排查

| 症状                      | 原因                                          | 解决                                                                    |
| ------------------------- | --------------------------------------------- | ----------------------------------------------------------------------- |
| 「连接失败:HTTP 401」     | apiKey 无效                                   | 在 provider 控制台核对 key,粘贴正确值,再点测试                          |
| 「连接失败:HTTP 404」     | baseURL 拼错,多写了 `/chat/completions` 后缀  | 去掉后缀,只填到 `…/v4` / `…/v1`                                         |
| 「连接失败:fetch failed」 | 域名/端口不可达,或 backend 出口被防火墙拦截   | `curl -v {baseURL}/chat/completions`,检查 DNS / 出口 ACL                |
| 「连接成功但模型没回话」  | 模型不存在或未授权                            | 换一个 provider 提供的 model id;华为云 ModelArts 需在控制台开通对应模型 |
| 启动日志 `source=default` | DB 没数据 + env 也没设                        | 进入 UI 填一次保存                                                      |
| Hermes 答非所问           | thinking 模式不合适(disabled 时 LLM 不深推理) | UI 切换 `enabled`,保存,重试问题                                         |
| 工具调用超 hop            | maxHops 太小 或 LLM 在工具间打转              | UI 改 maxHops 到 8-10;同时缩窄问题描述                                  |

## 与旧 opencode 路径的关系

v2.3.3 的 backend 通过 `OpencodeToolCallingRunner` 间接走 OpenAI 协议,凭据从
`~/.config/opencode/opencode.json` 文件读。v2.3.4 引入 `OpenAICompatibleRunner`
替代,**不再读任何本机配置文件**,凭据全部走 DB 管理。

为兼容现网历史问答,保留:

- `OpencodeAgentRunner` (基于 opencode SDK 的 prompt-only 路径):仅当 `HERMES_AGENT=1` 时启用
- `OpencodeToolCallingRunner` 类体已删除,文件保留 deprecation 注释

新部署 / 滚动升级时直接 UI 配 LLM 即可,无需安装 opencode CLI / 配置 opencode.json。

## v2.3.5 增量 — 模型列表动态刷新 + 部署 systemd drop-in 自动清理

### 模型列表动态刷新

v2.3.4 的「LLM 设置」页面里 `defaultModel` / `smallModel` 是 AutoComplete + 硬编码 `PROVIDER_DEFAULTS.models`(7-8 个常用 model 名)。问题:provider 改了/上新模型,前端不刷新就看不到。

v2.3.5 新增 `GET /api/llm-settings/models`(admin only):

- 凭据来源:DB `llm_settings` → env `HERMES_LLM_*` fallback
- 调 `${baseURL}/models`(OpenAI 兼容标准 endpoint),15s 超时
- 返回 `{models: [{id, owned_by?}]}` 或 `{error}`
- 兼容三种 provider 返回格式:OpenAI 标准 `{data:[...]}`、纯数组、`{models:[...]}`

**UI 行为**:

- `defaultModel` / `smallModel` 标签旁多了一个「🔄 刷新模型列表」按钮(`ReloadOutlined`)
- 点击 → `api.listLlmModels()` → 注入 `dynamicModels` state → 表单控件由 `AutoComplete` 切换为带搜索的 `Select`(选项来自 provider 真实列表)
- 成功 `message.success("已刷新 N 个模型")`,失败 `message.warning(error + "降级使用内置模型列表")` 自动回退 AutoComplete + 内置列表
- 提示文本同步:成功时显示「已从 provider 拉取 N 个真实模型」

**CLI**:暂无对应命令(`llm:set --model ...` 仍直接提交,model 列表查找用 UI 即可)。

### 默认 model 改 glm-4-flash

`apps/backend/src/app.ts` 三层 fallback 链(DB → env → 默认)最末端的默认 model 由 v2.3.4 的 `glm-4.5-air` 改为 `glm-4-flash`。原因:v2.3.4 教训智谱 `zhipu` apiKey 在 OpenAI 兼容 endpoint 下 `glm-4.5/4.6/5` 都需余额,**`glm-4-flash` 免费可用**,作为零成本默认值更稳。

- `PROVIDER_DEFAULTS.zhipuai-coding-plan`: defaultModel/smallModel 都改 `glm-4-flash`
- 内置 `models` 提示列表 `glm-4-flash` 排第一位

### /test 的 env-fallback

`POST /api/llm-settings/test` 的凭据优先级链由 v2.3.4 的 `body → DB` 扩展为 `body → DB → env`:

- 新部署 admin 还没存 DB,直接通过 systemd `Environment=HERMES_LLM_API_KEY=...` 启动 → UI 上「测试连接」按钮一点就能验通
- 单测覆盖三条 fallback 路径

### 部署 — systemd drop-in 自动清理

v2.3.4 现网部署中曾出现:多个 `/etc/systemd/system/combat-v2.service.d/*.conf` 同时设置同一 env key(比如 `HERMES_MODEL` 同时出现在 `hermes.conf` 和 `hermes-llm.conf`)。systemd 按字典序加载,后者覆盖前者,但运维改值后老 drop-in 会"偷偷复活",诊断困难。

v2.3.5 起,`scripts/deploy-v2/deploy-direct.mjs` 在每次部署的 5/5 阶段(daemon-reload 之前)自动:

1. 扫描 `/etc/systemd/system/combat-v2.service.d/*.conf`
2. 解析每个文件的 `Environment=KEY=VAL` 行,提取 env key
3. 检测同一 key 出现在多个文件 → 冲突
4. 把非权威文件改名 `.bak.<timestamp>` 备份(权威 = `hermes-llm.conf`),保留权威文件
5. 输出日志 `[drop-in] drop-in.cleanup removed=[...] kept=[...]`

实际清理只是 `mv`,可随时回滚。

加 `--keep-old-drop-ins` flag 关闭自动清理(谨慎模式)。

详见 `docs/UPGRADE.md` 的「systemd drop-in 自动清理」章节。
