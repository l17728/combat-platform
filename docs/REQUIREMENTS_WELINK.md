# Welink 群消息集成 + AI 信息抽取与对话式补齐 (需求草案)

> 状态:**原始需求记录,尚未实施**
> 提出时间:2026-05-30
> 分支:`feature/welink-integration`
> 关联模块:攻关单详情 / AI 助手 / 成员管理

---

## 一句话价值

把作战群(Welink)的真实对话上下文,无侵入地变成攻关单的"知情源",让 AI 助手不仅能基于结构化数据回答,还能基于一手聊天记录抽取关键信息、发现数据缺口,并通过对话补齐(成员、角色、关键节点),把组长从"群里翻聊天记录摘要"的体力活里解放出来。

---

## 核心场景

### 场景 1 — 群消息同步
- 群里发布一个 **下载工具**(Windows 桌面客户端,组长本机执行),工具从 Welink 拉取该群的全部聊天记录,**保证去重**(基于消息 ID),导出为标准 JSON
- 组长打开攻关单详情 → **「Welink」标签页** → 点上传按钮,提交导出的 JSON
- 后端收下,**直接覆盖**原有记录(下载工具已保证去重,服务端不再重排)

### 场景 2 — AI 后台抽取
- 上传后 AI agent 异步分析:
  - 时间线上的关键节点(谁先提出问题、谁认领、谁提出方案、谁验证、谁结案)
  - 提到的资源/人物/事件实体
  - 决策点与争议点
  - 截图/链接附件的语义化标签

### 场景 2.5 — 消息粒度控制(用户提出的补充)

Welink 标签页内,用户对已上传消息有**完全的选择和删除控制权**:

- **多选 / 全选 / 取消选**:消息列表每行带 checkbox,顶部勾选条「全选 / 取消全选 / 反选」;支持按时段、按发言人、按关键词三种快捷过滤面板,降低勾选成本
- **删除**:单条 / 批量物理删除(从 \`welink_messages\` 表 DELETE,或软删 \`deleted_at\` 字段供撤销);删除后这些消息不再进入 AI 抽取范围,不出现在时间线
- **「让 AI 分析」按钮**只对当前 \`选中 = true AND deleted_at IS NULL\` 的子集生效;界面顶部实时显示「已选 12 条 / 共 384 条」
- **典型场景**:组长上传后想"只让 AI 分析昨天下午 3 点后真正讨论问题的消息,过滤掉早上的闲聊和无关吐槽" → 时段筛选选「昨天 15:00 后」+ 关键词排除「哈哈/吃饭」→ 勾选剩下的 → 让 AI 分析

### 场景 3 — 对话式问答(基于群消息+结构化数据)
- AI 助手浮窗里可直接问"小王是几号开始介入的?""谁最早提到那个 OOM 现象?",AI 同时检索结构化数据 + 群消息回答,带可点击溯源(具体消息时间戳/作者/链接到原消息上下文)

### 场景 4 — 数据缺口发现 + 对话式补齐 ⭐(差异化亮点)
**用户:**(打开攻关单,AI 助手浮窗自动提示)
> AI:"我注意到这个攻关单的攻关成员只有 2 个(张三、李四),但群里活跃发言的人有 15 个。要不要把群里的人加进成员名单?"

**用户:**"除了张三,其他都加进来"

**AI:**(调用 \`add_members\` 工具补齐 13 个成员)
> "好的,已加入 13 位:王五、赵六、钱七……。需要给哪些人指定为「组长」角色吗?默认全部是「组员」"

**用户:**"王五是组长"

**AI:**(调用 \`set_member_role(王五, 组长)\` 工具)
> "完成。现在 1 名组长 + 14 名组员,与群里活跃成员对齐。是否同时把群里提到的「华为云客户运维群」拉成 emailGroup,用于后续邮件通知?"

**用户:**"嗯,组名就用「华为云客户运维」"

**AI:**(调用 \`create_email_group\` 工具)
> "已创建,自动从消息抽取了 12 个邮箱填进去。要不要把这个群设为本攻关单的私密授权群组?"

…

这个对话流是产品差异化的核心 — AI 不是被动问答,而是基于数据 gap 主动询问,基于自然语言指令 **调工具** 完成多步操作。

---

## 技术分析

### 三大组件
1. **Windows 桌面下载工具**(独立项目,可能用 Electron + Welink 协议逆向)
   - 输入:用户登录 + 选择群
   - 输出:标准 JSON 文件(消息 ID / 时间 / 作者 / 内容 / 附件 URL)
   - 去重:基于 Welink 消息 ID
   - 分发:打包成 .exe,通过 docs/welink-tool-readme.md 分发到群里
   - **风险**:Welink 客户端协议不公开,可能需要 hook DOM 或 IPC;法律合规需提示用户

2. **后端接收 + 存储**
   - 新表:\`welink_messages\` (id, ticketId, messageId, sentAt, author, content, attachments, raw, created_at)
   - 唯一约束:(ticketId, messageId) — 覆盖式 upsert
   - 端点:
     - \`POST /api/tickets/:id/welink-messages\` — 批量上传(JSON 数组,事务覆盖)
     - \`GET /api/tickets/:id/welink-messages\` — 分页查阅 + 过滤(time range / author / keyword)
     - \`DELETE /api/tickets/:id/welink-messages\` — 清空(给重新上传用)
     - \`DELETE /api/tickets/:id/welink-messages/:messageId\` — 单条软删(set deleted_at)
     - \`POST /api/tickets/:id/welink-messages/batch-delete\` — 批量软删({ ids: [...] })
     - \`PATCH /api/tickets/:id/welink-messages/selection\` — 批量改选中状态({ ids: [...], selected: bool })
     - \`POST /api/tickets/:id/welink-messages/analyze\` — 仅对选中+未删除子集触发 AI 抽取
   - 后台 worker:消息入库后异步触发 AI 抽取 → 写入 \`welink_extractions\` 表(实体/节点/争议/决策)

3. **前端 Welink 标签页**(攻关详情新固定 Tab,或动态 Tab)
   - 顶部条:上传区(拖拽 .json 文件)+ 上次同步时间 + 消息总数 + 「已选 N 条」实时统计
   - 主区:消息列表(类似邮件客户端的勾选表) — 每行 checkbox / 时间 / 发言人 / 内容预览 / 操作(删除)
   - 工具栏:全选 / 取消全选 / 反选;时段筛选(date range picker)/ 发言人多选 / 关键词包含/排除
   - 底部:**「让 AI 分析(N 条)」按钮 → 仅对当前选中 + 未删除子集触发抽取**;抽取结果显示在右侧抽屉
   - 删除:行级单条删除(Popconfirm)+ 顶栏批量删除(已选)

4. **AI 助手扩展**(新增工具集)
   - 现有 hermes_lookup / hermes_getContext / hermes_ticketTabs / hermes_recommendHelpers
   - 新增工具(给 opencode agent 用):
     - \`welink_search\`(query)— 全文搜群消息
     - \`welink_timeline\`(ticketId)— 拉时间线
     - \`welink_extract_entities\`(ticketId)— 调 LLM 拉实体
     - \`gap_analysis\`(ticketId)— 比对群里活跃人 vs 攻关成员,返回 gap
     - \`add_members\`(ticketId, names)— 批量加成员(调用现有 syncMemberFields)
     - \`set_member_role\`(ticketId, name, role)— 改单人角色
     - \`create_email_group\`(name, emails)— 新建 emailGroup
   - agent 编排:在 \`hermes.md\` 加入"主动 gap 分析"提示 — 用户进入 Welink tab 时,助手自动跑 \`gap_analysis\` 并基于结果发起对话

### 数据模型补充
\`\`\`
welink_messages
  id            TEXT PK
  ticket_id     TEXT
  message_id    TEXT   -- Welink 原消息 ID,(ticket_id, message_id) 唯一
  sent_at       TEXT   -- ISO 时间戳
  author        TEXT   -- 显示名
  author_id     TEXT   -- Welink user id (可选)
  content       TEXT   -- 文本
  attachments   TEXT   -- JSON 数组 [{type, url, name}]
  raw           TEXT   -- 原始 JSON 行,供调试
  selected      INTEGER DEFAULT 1   -- 是否纳入 AI 分析范围(用户勾选控制)
  deleted_at    TEXT NULL           -- 软删除时间戳;NULL 表示有效
  created_at    TEXT

welink_extractions
  id            TEXT PK
  ticket_id     TEXT
  kind          TEXT   -- 'entity' | 'event' | 'decision' | 'dispute'
  label         TEXT
  payload       TEXT   -- JSON
  source_msg_id TEXT   -- 溯源到具体消息
  created_at    TEXT
\`\`\`

### 安全/合规
- 群消息可能含敏感信息 → 上传成功后**自动标 私密 = 是**(创建人确认或默认开)
- 下载工具必须显式提示用户:"仅同步组长本人可见的群消息,不绕过 Welink 权限"
- 服务端存储须满足公司数据治理(Welink 原文本是否可落库 → 法务确认)

### 工期估算(从 0 到 MVP)
- W1:数据模型 + 后端 API + Welink Tab 静态 UI(无 AI)
- W2:Windows 下载工具 PoC(可能砍掉,用「手动复制群消息粘贴框」替代)
- W3:AI 抽取 worker + 时间线渲染
- W4:gap 分析 + 工具集 + 对话式补齐 + e2e
- ~ **3-4 周到可用,3 个月到稳态**

---

## 待决策点(实施前必须拍板)

1. **Welink 下载工具的实现路径**:Electron + 客户端 hook? IPC? 还是降级为「让组长在 Welink 网页版手动 ctrl+a 复制聊天粘到上传框」?
2. **AI 抽取是同步还是异步**:同步阻塞(用户等几秒)还是 async worker + 用户后台通知?
3. **多群合并**:一个攻关单是否绑多个 Welink 群?MVP 1:1 最简
4. **消息原文落库范围**:仅文本?还是包括截图二进制?二进制存对象存储还是丢弃只留链接?
5. **私密策略**:上传 Welink 消息时是否强制把攻关单设为私密?
6. **对话式补齐的工具权限**:AI 调 \`add_members\` 时是否需要二次确认(用户回"确认"才执行)?自动执行风险较高

---

## 待办与下一步

- [ ] 法务/合规预审(数据敏感性、Welink 协议授权)
- [ ] 与 1 个真实攻关单组长访谈,验证"群里 15 人 vs 成员 2 人"这个 gap 在生产环境是否真的高频
- [ ] 评估 Welink 下载工具 PoC 可行性,如不可行,降级方案是否被用户接受
- [ ] 评估 Hermes(opencode/glm-5)的工具调用稳定性,是否能支持「除张三外其他都加」这种含否定的指令

---

## 聊天视图实现细节(2026-05-30 更新)

> 状态:**已实施**(`feature/welink-integration` 分支)

### 已做(MVP)

#### 原始格式适配
- `welink_messages` 表新增三列:`content_type` / `content_json` / `images_json`(用 ALTER 增量添加,兼容已有数据)
- 解析支持真实 Welink 字段命名:
  - 消息 ID:`msgId` / `id` / `messageId` 三选一
  - 时间戳:`serverSendTime` / `sentAt` / `time` / `timestamp` / `sendTime` 任一,epoch ms/sec 自动归一化为 ISO 8601
  - 发言人:`sender` / `author` / `from` / `userName` 任一
- 按 `contentType` 分类解析:
  - `TEXT_MSG`:`content` 直存
  - `CARD_MSG`:从 `content.cardContext.replyMsg.content` 提取主文本到 `content`,完整卡片 JSON 存 `content_json`
  - `PICTURE_MSG`:`images` 数组存 `images_json`,`content` 默认 `[图片]`
  - 其它/未知:对象 content 转 JSON,字符串 content 直存
- 后端 e2e 覆盖三种 contentType + 时间戳归一化

#### 聊天视图组件(`WelinkChatView.tsx`)
- 经典聊天布局:
  - 头像:姓名首字 / 工号末两字,基于 sender hash 得 HSL 颜色(同人同色)
  - 姓名行:`[姓名] · [工号] · [HH:mm:ss]`;查无姓名时只显工号
  - 气泡:浅灰背景 + 圆角 + max-width 70%
- TEXT_MSG:普通文本气泡;`@提及` 蓝色高亮;`http(s)://` 自动渲染为 `<a target="_blank">`
- CARD_MSG:上半部分灰色块显引用(preMsg);下半部分显回复(replyMsg)
- PICTURE_MSG:气泡内嵌缩略图(max 200×200),点击 Ant Design Image 放大
- 日期分隔:不同天用居中分隔条 + 中文星期
- 时间分组:同发言人 5 分钟内连续消息合并为一组(只显示一次头像+姓名)
- 工具栏:跳到最早 / 跳到最新 / 刷新;DatePicker 时段筛选;发言人多选筛选
- 默认滚到最新一条
- 姓名查询:从 `/api/nodes/person` 拉全员,构造 `工号→姓名` Map,前端缓存 5 分钟

#### 视图切换
- `WelinkTab` 顶部加 Segmented「列表视图 / 聊天视图」
- 偏好持久化到 `localStorage('combat-welink-view')`
- 列表视图保留所有原有功能(勾选/筛选/删除/AI 分析按钮)

### 待做(下阶段)

- **图片源加载策略**:目前直接 `<img src={url}>` 渲染原图;若 Welink CDN 需鉴权,可能要后端加 proxy
- **滚动加载更多**:当前一次拉 2000 条上限,未做按时间分页加载
- **场景 3 对话式问答(基于群消息)**:虽然 hermes_welinkSearch/Timeline 工具已就绪,
  但 e2e 还没断言 agent 调用群消息工具回答(因为 e2e backend 不开 HERMES_AGENT)

---

## 场景 2 (AI 抽取) + 场景 4 (gap + 对话式补齐) 实施细节(2026-05-30 更新)

> 状态:**已实施 v1**(`feature/welink-integration` 分支,commit 728f65c..09faa9a)

### 后端落表

新增 `welink_extractions` 表:
```sql
CREATE TABLE welink_extractions (
  id             TEXT PRIMARY KEY,
  ticket_id      TEXT NOT NULL,
  kind           TEXT NOT NULL,    -- entity / event / decision / dispute / gap
  label          TEXT NOT NULL,
  payload        TEXT NOT NULL,    -- JSON
  source_msg_ids TEXT,             -- 溯源消息 id,逗号分隔
  created_at     TEXT NOT NULL,
  created_by     TEXT,             -- 'hermes' / 'heuristic'
  reviewed       INTEGER NOT NULL DEFAULT 0
);
```

### analyze 端点工作流(`apps/backend/src/welink-extraction.ts`)

`POST /api/tickets/:id/welink-messages/analyze` 不再占位:
1. 取 `selected=1 AND deleted_at IS NULL` 的消息;0 条直接返回
2. 序列化成精简文本(超 200 条按时间三分桶采样,防 prompt 爆炸)
3. **优先 AgentRunner**(opencode hermes,模型 huawei_cloud/glm-5):
   构造结构化抽取 prompt(指定输出 5 类 JSON 数组),正则 `\`\`\`json\`\`\`` 块抽 JSON
4. **启发式回退**:agent 失败 / 不可解析 / 缺 entity-gap 类时,
   规则回退保底产出(entity=按发言人统计、event=首末发言、gap=活跃发言 vs 已登记成员差集)
5. 落 `welink_extractions` + 返回 `{ok, queued, extracted, source, extractions}`
6. `source` ∈ `agent` | `agent+heuristic` | `heuristic`,便于排查

MVP 同步阻塞;数据量 < 1000 是几秒级。异步 worker + SSE 进度推送留作下阶段。

### 抽取结果 CRUD

- `GET /api/tickets/:id/welink-extractions?kind=&reviewed=` — 查询
- `GET /api/tickets/:id/welink-extractions/:extId` — 单条
- `PATCH /api/tickets/:id/welink-extractions/:extId` — `{ reviewed?, label?, payload? }`
- `DELETE /api/tickets/:id/welink-extractions/:extId`

### Agent 端点(场景 4 闭环)

`apps/backend/src/welink.ts` 加 5 个端点,既给 Hermes 工具用、也给前端直接调:

- `GET /api/tickets/:id/welink/search?q=` — 全文搜该 ticket 的 welink 消息
- `GET /api/tickets/:id/welink/timeline?limit=` — 时间升序的精简时间线
- `GET /api/tickets/:id/welink/gap-analysis` — 活跃发言人 vs 已登记成员差集,
  含工号→姓名反查(优先 person.工号 / 退回 sender 原值)
- `POST /api/tickets/:id/welink/add-members` — `{names, role?}` 批量加,
  默认组员;自动去重 + `syncMemberFields` 同步「成员列表/攻关组长/攻关成员」三方
- `POST /api/tickets/:id/welink/set-member-role` — `{name, role}` 改单人角色

`apps/backend/src/welink-members.ts` 镜像前端 `utils/teamMembers.ts` 的 parseMembers/syncMemberFields,
保证两端「成员列表 JSON 真源 + 攻关组长/攻关成员 派生」规则一致。

### Hermes 工具集扩展(`apps/backend/hermes-workspace/.opencode/tools/hermes.ts`)

在原有 lookup/getContext/recommendHelpers/ticketTabs 基础上 +6:

| 工具 | 类型 | 触发关键字 |
|------|------|------|
| `hermes_welinkSearch(ticketId, q)` | 只读 | "群里谁说过 X" |
| `hermes_welinkTimeline(ticketId, limit?)` | 只读 | 时间脉络 / 首次谁认领 |
| `hermes_gapAnalysis(ticketId)` | 只读 | **主动:用户提到群/成员/补齐时调** |
| `hermes_welinkAddMembers(ticketId, names, role?)` | 写 | "把 X、Y 加进来" |
| `hermes_welinkSetMemberRole(ticketId, name, role)` | 写 | "把张三设为组长" |
| `hermes_createEmailGroup(groupName, emails, description?)` | 写 | "建一个 xxx 邮件群" |

> 写工具的 `names`/`emails` 用逗号分隔字符串而非数组,规避 opencode plugin `schema.array` 兼容差异。

`apps/backend/hermes-workspace/.opencode/agents/hermes.md` 从"只读问答"升级为
"以只读为主 + 允许明确的成员维护写入",并加 **Welink 场景对话脚本**:

1. 用户进入 Welink 场景(提到群/聊天/成员/活跃/补齐)→ 主动调 gapAnalysis
2. 有 gap → 主动报告候选 + 问"要加进来吗?"
3. 用户回"都加 / 加 X / 除 Z 外都加" → 解析为 welinkAddMembers 调用

### 前端

- `apps/frontend-v2/src/pages/WelinkExtractionsDrawer.tsx`(新)
  - width=520 Drawer,Tabs 按 5 类分组(人物 / 时间线 / 决策 / 争议 / 缺口)
  - 卡片化展示 label + JSON payload + 时间
  - **「缺口 / 人物」类**直接「加入攻关成员」按钮 → 调 `welink/add-members`
  - 「标已查阅」标灰 + 排在后面;「删除」Popconfirm 确认
- `WelinkTab` 改造:
  - 统计行加「AI 抽取 (N)」按钮 → 打开 Drawer
  - 「让 AI 分析」按钮改为同步等待 → toast 反馈 queued/extracted/source → extracted>0 自动开 Drawer
  - 聊天视图下也加「让 AI 分析」按钮(同 testid 不同后缀)
- `HermesChat` 扩展:加 `context` / `greeting` / `testId` 三个 props
  - `context` 透传给 `/api/hermes/ask`(让 agent 知道当前 ticketId)
  - `greeting` 打开浮窗时由 assistant 先发一条引导(场景 4 入口)
- `WelinkTab` 挂载 `HermesChat`:
  ```ts
  context: `当前攻关单 id=${ticketId};用户正在 Welink 群消息场景。若用户问及成员/补齐/活跃,主动调 hermes_gapAnalysis(ticketId)。`
  greeting: 列出 3 例对话模板
  ```

### 测试

- `apps/backend/test/welink-extraction.e2e.test.ts` 5 tests:5 类落表 + 全 CRUD + 空消息 + 404 + kind 过滤
- `apps/backend/test/welink-members.e2e.test.ts` 7 tests:search/timeline/gap-analysis(工号反查)/add-members(默认组员/指定组长)/set-member-role/invalid payloads
- 原 `welink.e2e.test.ts` 内 analyze 占位测试改为新逻辑断言(source=heuristic, kinds 含 entity+gap)
- `apps/frontend-v2/e2e/welink-extraction.spec.ts` 5 tests:
  - 「让 AI 分析」→ extractions 非空 + Drawer 自动开
  - Drawer 分类 Tabs + 缺口 Tab 含未登记发言人
  - 缺口里「加入攻关成员」→ ticket.成员列表 length+1
  - AI 助手浮窗 → greeting 可见 → 提问得到回答(走规则引擎 fallback)
  - 对话补齐链路:直调 add-members API(等价 agent 落点)→ ticket 成员管理 tab 见新人

## 场景 3 实施细节(2026-05-30)

> 状态:**已实现**。AI 回答群消息相关问题时返回带可点击溯源的 welink citation,点击跳转到该消息在聊天视图的位置并 2 秒黄背景高亮。

### 差异化亮点

普通问答 = 文本回答 + 节点链接;场景 3 = 文本回答 + **逐条群消息溯源**,点击 Tag → SPA 跳转到该 welink 消息所在攻关单的 Welink Tab → 自动切换到聊天视图 → 滚动到该消息并加 2 秒黄底高亮。让"AI 说话有出处,出处可点击直达原文"。

### 数据契约扩展

`packages/shared/src/types.ts` — `HermesCitation` 加 3 个可选字段(向后兼容,旧客户端忽略即可):

```ts
export interface HermesCitation {
  nodeId: string; nodeType: string; summary: string; link: string;
  kind?: 'node' | 'welink';      // 默认 'node'
  messageId?: string;             // kind='welink' 时填,welink 原消息 id
  ticketId?: string;              // kind='welink' 时填,所属攻关单 id
}
```

welink kind 的 link 格式固定为 `/attack/<ticketId>?tab=welink&welinkMsg=<messageId>`,这是前端解析的契约。

### 后端实现

**1. agent 输出协议扩展** — `apps/backend/src/hermes-agent.ts`
- `buildHermesPrompt` 加规则 6:除标准 `CITATIONS` 行外,从 welink 工具拿数据时**再追加一行** `WELINK_CITATIONS: [{"messageId":"...","brief":"..."}]`
- `parseAgentOutput` 升级:返回 `{answer, citedIds, welinkHints}`(原 `{answer, citedIds}` 子集兼容)
- 新增 `buildWelinkCitations(db, hints, ticketIdHint)`:每条 hint 回查 db 校验,**编造的 messageId 静默丢弃**(防幻觉)
- `answerWithAgent` 多接 `db` 参数,把 welink citations 合并到 `answer.citations` 后段

**2. 规则引擎兜底** — `apps/backend/src/hermes.ts`
- `WELINK_KEYWORDS` 正则:`/群里|聊天|welink|说过|提到|介入|最早|第一个|谁先|什么时候|何时|哪天/i`
- `extractTicketIdHint(context)`:从 `ticketId=xxx` 模板解析当前攻关单 id
- `extractKeywords(question)`:去标点 + 停用词,取前 4 个 token(>=2 字符)
- `welinkFallbackCitations(db, question, ticketId)`:对每个 keyword `LIKE %kw%` 扫 `welink_messages` 取前 5 条,合并去重,排前 3 条作为兜底 citation
- agent 路径:**agent 没给 welink 引用且问题命中关键字** → 用 fallback 补
- rule 路径:**直接补 fallback** — 规则引擎本身不查 welink_messages

**3. agent prompt** — `apps/backend/hermes-workspace/.opencode/agents/hermes.md`
新增「场景 3 — Welink 群消息问答带溯源」章节,定义触发关键字、回答格式 `[YYYY-MM-DD HH:MM]`、`WELINK_CITATIONS` JSON 输出协议,并给一个完整示例。

### 前端实现

**1. HermesChat 渲染 welink Tag** — `apps/frontend-v2/src/components/HermesChat.tsx`
- `Citation` interface 加 `kind / messageId / ticketId` 可选字段
- 渲染 Tag 时按 `kind === 'welink'` 切 `geekblue` 色 + "群消息 ·" 前缀 + tooltip 提示"点击跳转并高亮"
- 用 `data-testid="hermes-welink-citation"` / `hermes-node-citation` 区分,便于 e2e 断言

**2. AttackDetail 解析 query** — `apps/frontend-v2/src/pages/AttackDetail.tsx`
- 接 `useSearchParams`,读 `?welinkMsg=...` / `?tab=welink`
- `activeTabKey` 由 undefined 改受控,query 命中时 `setActiveTabKey('welink')`
- 用户主动切走 welink tab 时清掉 query(避免再次激活高亮)
- 透传 `highlightMessageId={queryWelinkMsg}` 给 `<WelinkTab>`

**3. WelinkTab 透传** — `apps/frontend-v2/src/pages/WelinkTab.tsx`
- 加 `highlightMessageId?` prop
- 非空时强制 `setViewMode('chat')`(聊天视图才能滚动锚点)
- 透传给 `<WelinkChatView highlightMessageId={...}>`

**4. WelinkChatView 高亮滚动** — `apps/frontend-v2/src/pages/WelinkChatView.tsx`
- 每个 `MessageBubble` 加 `data-welink-msg-id={msg.messageId}` 锚点 + `highlighted` prop
- 高亮样式:`background:#fffbe6 + border:#ffe58f + boxShadow + transition 0.3s` + `className="welink-msg-highlight"`(供 e2e CSS 选择器)
- `activeHighlight` 状态(由 prop 触发,2 秒后清空)
- 数据就绪后用 `containerRef.querySelector('[data-welink-msg-id="..."]').scrollIntoView({behavior:'smooth', block:'center'})`
- 默认 "滚到底部" 的 effect 在 `activeHighlight` 激活时禁用,避免被覆盖

### 防幻觉与降级

| 风险 | 处置 |
|------|------|
| agent 编造 messageId | `buildWelinkCitations` 用 db 回查;不在表里的项**静默丢弃**,不进 citations |
| agent 完全没输出 `WELINK_CITATIONS` | 后端兜底:问题命中 welink 关键词 → 关键词扫 welink_messages 排前 3 条补充 |
| agent 关 / 调用失败 | 规则引擎一样会跑 welink 兜底,场景 3 保持可用 |
| WELINK_CITATIONS JSON 解析失败 | try/catch 静默,`welinkHints` 空,降级到 fallback |
| 虚拟滚动?无 | WelinkChatView 渲染所有 bubble 到 DOM,scrollIntoView 直接可用 |
| query 残留导致每次进页面都高亮 | 用户切走 welink tab 时清掉 query |

### 测试

- `apps/backend/test/hermes-agent.test.ts` 新增 7 个单测:
  - `parseAgentOutput` 解析 `WELINK_CITATIONS` JSON / 缺失 / 损坏
  - `buildWelinkCitations` 真实命中 / 编造丢弃 / db 缺失 / 空 hints
  - `answerWithAgent` 端到端透传 welink citation
- `apps/frontend-v2/e2e/welink-citation.spec.ts` 新增 3 个 e2e:
  - 后端 `/hermes/ask` 在群消息问题下返回 `kind=welink` citation,messageId 真实存在,link 含 `welinkMsg=` query
  - URL `?welinkMsg=<id>` 自动切到聊天视图 + 气泡可见 + `.welink-msg-highlight` 类生效
  - AI 浮窗提问 → welink citation Tag 可见 → 点击 → SPA 跳转 + 高亮气泡可见

### 容错与降级路径

| 场景 | 行为 |
|------|------|
| `HERMES_AGENT=0`(默认) | analyze 直接走启发式,extractions 仍非空 |
| `HERMES_AGENT=1` 但 opencode 不可达 | catch 内回退启发式,日志 `welink.extract.agent_fail` |
| agent 返回不可解析 JSON | 日志 `welink.extract.agent_unparseable`,走启发式 |
| agent 只返回了 event/decision 没 entity/gap | 启发式补 entity + gap,source 标 `agent+heuristic` |
| 0 条选中消息 | 早返回 `queued=0, extracted=0`,UI 提示先勾选 |

### 已知卡点(给场景 3 的提醒)

- **e2e 不能真跑 agent 工具调用**:e2e backend 默认关 agent,
  场景 3 "AI 用 welinkSearch/Timeline 回答群消息相关问题"无法在 e2e 里端到端验证。
  现在的 e2e 只验证了「AI 助手浮窗可打开 + greeting 显示 + 规则引擎 fallback 回答」。
  场景 3 上线时必须人工跑通 HERMES_AGENT=1 + 真实 LLM,断言 agent 在群消息上下文里能调对工具。
- **agent 工具调用稳定性未知**:opencode + glm-5 调结构化输出(JSON 抽取、解析否定指令"除 X 外")在本期未现网验证;
  prompt 已要求 ```json fence,提供启发式回退兜底,但 agent 调用 add_members 时是否能正确解析"除张三外其他都加"未实际测试。
- **写工具二次确认**:本期 add_members 由 agent 调时直接执行,没二次确认 — 待决策点 #6 仍是开放问题。
  当前缓解:agent.md 写明"仅在用户明确表达想要加成员时调用";若误调,用户在「成员管理」tab 可一键删。

## 反向风险

- **群里说的不一定是事实** — 群里的人不一定是攻关成员(可能只是路人围观)。AI 主动建议补齐可能造成"成员名单膨胀"。建议:
  - 不无条件批量加,先让 AI 列出候选 + 每人发言次数/最早出现时间,让用户挑
  - 默认全部以 组员 加入,组长仍需用户显式指定
- **隐私 / 合规** — 一旦数据进了 app,组长离职/调岗后这些群消息谁负责?需要数据保留策略
- **AI 误抽取** — 早期 LLM 抽取出错率高,要给用户"撤回 AI 补齐"按钮,一键回滚到上传前的成员列表
