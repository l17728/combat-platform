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

## 反向风险

- **群里说的不一定是事实** — 群里的人不一定是攻关成员(可能只是路人围观)。AI 主动建议补齐可能造成"成员名单膨胀"。建议:
  - 不无条件批量加,先让 AI 列出候选 + 每人发言次数/最早出现时间,让用户挑
  - 默认全部以 组员 加入,组长仍需用户显式指定
- **隐私 / 合规** — 一旦数据进了 app,组长离职/调岗后这些群消息谁负责?需要数据保留策略
- **AI 误抽取** — 早期 LLM 抽取出错率高,要给用户"撤回 AI 补齐"按钮,一键回滚到上传前的成员列表
