# UX / 产品 / 灵活性 评审 — by 前 Notion 产品负责人

日期: 2026-05-30 | 分支: master @ `6783b0f`
评审人: 前 Notion / Linear / Airtable PM 视角（15 年 SaaS 产品 / 信息架构经验）
评审范围: `apps/frontend-v2/`（**只读**，未改动任何源代码）

---

## 总评分: 7.0 / 10

**一句话定调**: 这是一个被严肃打磨过的内部工具 — 在"贡献追踪 + 应急攻关 + 结构化知识图谱"这个垂直域已经超越大多数 Jira 替代品；但作为产品它仍然像"内部超级表"，离 Linear / Notion 那种"每个像素都在替你思考"还有 1 个版本的距离。差距集中在 **首屏认知负荷**、**键盘流**、**信息架构层级冗余**、**AI 助手的曝光与上下文绑定** 四件事上。

---

## 与对标产品对比

| 产品 | 我们 vs 它的差异 | 谁赢? |
|------|------------------|-------|
| **Linear** | Linear 几乎只用键盘（C 新建、L 加标签、A 派人），我们全部 mouse-only；Linear 的导航 < 3 层，我们有 4 层（系统管理 → 审核管理 → 关系审批）。但我们有 **关注列表整行高亮**、**返回保留筛选**、**列宽/列顺序拖拽持久化** 这些 Linear 都没有。 | 综合: **Linear 微胜**；列表打磨: **我们胜** |
| **Jira** | Jira 像沼泽——配置无穷但每步都点 6 下；我们 **Schema-driven + 配置中心** 把字段管理从"管理员 5 分钟操作"压缩到"写 1 个 JSON 文件"。Jira 没有 KG，没有 AI 助手，没有动态 Tab。 | **我们完胜** |
| **Notion** | Notion 的 Database View 是宇宙级灵活，我们的 EntityTable + FlexTable + SchemaWizard 在思路上对齐但深度差 1 代——Notion 有 Filter Group / Sort Group / Group By / Calendar / Kanban / Timeline / Gallery 多视图，我们只有 Table + Cards。**信息广场** 是 Notion 风格的明显借鉴但弱化了。Notion 没有 KG 派生。 | 视图灵活: **Notion 完胜**；KG 集成: **我们胜** |
| **PagerDuty** | PD 的核心是 escalation policy + on-call 轮值 + SLA 倒计时，我们有 escalation/reminder 但缺 **"事件级别 P1 应该几分钟内响应"** 这种 SLA 时钟可视化；我们的 P1-P4 等级仅作为分类，没有 deadline countdown。 | **PagerDuty 胜**（应急域） |

**核心差异化卡位**: "配置驱动的 Jira" + "派生 KG 的 Linear" + "AI 问答可溯源的内部 Notion"。这个定位独特且有商业价值——但目前 **AI 助手仅在知识图谱页挂载**（KGGraph.tsx:387 是唯一一处 `<HermesChat>`），白白浪费了这个最强差异点。

---

## 维度评分

| 维度 | 分 | 评语 |
|------|---|------|
| 首次上手 | 6 / 10 | 登录页清爽（admin/admin123 直接显示在卡片底部，对内部工具来说友好），但进入 Dashboard 后没有 **新手引导/产品 Tour**，左侧 10+ 个菜单项一字排开心智负担重。仪表盘四个数字 + 两张卡，没有"建议你做的第一件事"。 |
| 任务效率 | 5 / 10 | "新建攻关 + 录贡献" 至少 8-10 步全鼠标；**零键盘快捷键**（grep `onKeyDown` 全空）；**列表无批量操作**（grep `rowSelection` 全空，无批量改状态/批量分配处理人/批量导出选中）；新建后跳详情很对，但 Drawer 内 11 个表单项无 Tab Order 优化。 |
| 信息架构 | 6 / 10 | 主菜单 10 个一级项 **太多**（Linear 是 4 个）；"求助中心 / 文档中心 / 全局搜索 / 知识图谱 / 问题反馈 / 帮助中心" 6 个并列同级，分类弱。"审核管理" 嵌套在"系统管理"下需要 3 级展开。**面包屑 ROUTE_MAP 是硬编码的**（PageBreadcrumb.tsx:4-22），路径 `/documents`、`/manual`、`/kg`、`/users`、`/op-log`、`/backup` 都没在 map 里 → 这些页打开后没有面包屑。 |
| 灵活性 | 9 / 10 | **这是产品的杀手锏**。Schema 驱动（JSON 文件即字段）、ConfigCenter（运行时枚举配置 + 删除前影响分析）、SchemaWizard 字段类型 7 种 + 概念锚点复用建议（`SuggestPopover`）、动态 Tab、字段隐藏（按用户名持久化）、关注列表（按用户隔离）、列宽/列顺序拖拽持久化（`useFlexTable`）。**罕见的深度** —— Notion 才有的级别。 |
| 视觉设计 | 8 / 10 | Ant Design 5 风格统一性极高，`constants.ts` 集中色板（STATUS_COLOR/LEVEL_COLOR/CONTRIBUTION_COLOR 等 12 套）；表格密度 size="middle"、Drawer 宽 480/560 分级；**信息广场卡片左侧 4px 彩色边条** 是亮点（InfoSquare.tsx:188）；**Tab 设计三段式**（基础信息 / 成员 / 进展 / 日报 / 求助网络）逻辑清晰。失分: 登录页紫色渐变 `#667eea → #764ba2` 太"2018 SaaS 模版风"，与产品冷酷工程师调性不一致。 |
| AI 助手 | 5 / 10 | HermesChat 设计本身漂亮（可拖拽悬浮 / 引用溯源 / Markdown 渲染 / Tag 跳转），**但只在 KGGraph 一处挂载**。攻关详情页没有挂！Dashboard 没有！这是产品最大的暴殄天物。攻关详情的"找帮手推荐"是规则引擎排名，没接 Hermes。**没有 inline @-mention AI**，没有 Notion AI 的"/" slash command。 |
| 错误反馈 | 7 / 10 | toast 文案通顺（"创建成功" / "状态流转成功"），message.error(e.message) 默认透传 backend error；私密 403 做了专用页（"无权访问")；ErrorBoundary 全局兜底；网络失败有 Empty + 重新加载按钮（Dashboard.tsx:48）。失分: 大量 catch 直接吞掉错误（`.catch(() => [])`），出问题时用户看不到任何提示，看到的是"暂无数据"。 |
| 细节打磨 | 9 / 10 | 真正打动人的地方: <br>1. **关注行整行淡黄底 + 左侧金边**（AttackList.tsx:380）<br>2. **返回列表保留 URL 筛选**（searchParams sync）<br>3. **私密 🔒 列表 + 详情双标识 + Tooltip + 创建人专属操作**<br>4. **进展 Timeline 合并审计**（filterKeyAudits 把状态流转/升级/合并/成员变更也并入）<br>5. **审计日志 entityId 反查显示名称**（不暴露 UUID）<br>6. **截图反馈 html2canvas + JPEG 0.7 压缩 + console capture**<br>7. **AttackList Popover 字段选择 + 全选/重置**<br>8. **基础信息字段按用户隐藏（localStorage 隔离）**<br>这些累计起来代表了非常成熟的产品 craftmanship。 |
| 可访问性 | 3 / 10 | **重大短板**。grep `aria-label / role= / tabIndex` 全站只有 1 处；**无键盘快捷键**；颜色单一依赖（绿/黄/红 → 色盲不友好，特别 STATUS_BAR 仅靠 hex 区分）；**完全无英文 i18n**（main.tsx:5-16 只 import zhCN，全代码中文字面量），外部协作 / 外籍员工 / 跨国客户场景失败；登录页紫色渐变和白卡对比度尚可但很多 `<Text type="secondary">` 在浅灰背景上对比度勉强。 |
| 产品差异化 | 8 / 10 | KG 派生 + Schema 驱动 + AI 溯源 这三件组合在内部协作工具里 **独此一家**。审计/进展/合并/升级全闭环；中文枚举值规范一致（"待响应 / 处理中 / 进行中 / 已解决 / 已关闭"）。失分: 差异化没有充分被用户感知到 —— Dashboard 上没有任何 KG 入口暗示，AI 助手不全站挂载，新用户进来三分钟感觉就是"另一个 Jira"。 |

---

## 五个"惊艳"细节（实证）

1. **关注行的双视觉编码** — `AttackList.tsx:380`：`background: '#fffbe6', boxShadow: 'inset 3px 0 0 #fadb14'`。淡黄底 + 内嵌左侧金条，在"全部" Tab 里关注的行一眼可辨，比 Linear 的"☆"图标列友好得多。而且 favorites key 按 username 隔离（`favKey()`, line 32），换账号不串。

2. **AttackList → Detail → 返回保留筛选** — `AttackList.tsx:137-143` 用 `setSearchParams` 把 field/val/q 全部映射 URL，浏览器 back 自动恢复。这是 Jira/Notion 都做不好的 — Jira 返回总是回到默认视图。

3. **进展 Timeline 智能合并审计事件** — `AttackDetail.tsx:447-475`：`filterKeyAudits` 把"状态流转 / 升级 / 合并 / 成员变更" 4 类关键审计自动并入 progress timeline 按时间倒排。一个时间轴看完全部故事，省去切 Tab。

4. **ConfigCenter 删除前影响分析** — `ConfigCenter.tsx:84-94` `getImpactFields()` 删配置项前扫描所有 schema 找出引用该配置项的字段，避免"删了枚举导致表单选项空"的级联事故。**这是真正生产级的配置管理思维**。

5. **私密攻关单的全链路守卫** — 列表（🔒 + 创建人专属删除）、详情（创建人专属管理/取消、Tooltip 解释、私密授权 Drawer 双多选）、URL 直访（403 → 专用 "无权访问" 页 with Lock 图标 + 返回按钮，AttackDetail.tsx:205-216）。**前后端 + UI + 路由四层闭环**，做得很扎实。

---

## 五个"刺眼"问题（实证）

1. **AI 助手只在知识图谱页挂载一次** — `grep "<HermesChat"` 仅 `KGGraph.tsx:387` 一处。**Hermes 是产品最强差异点，却被埋在二级菜单一个 5% 用户会访问的页面里**。攻关详情 / Dashboard / 全局搜索都应该挂全局浮窗。
   - 影响: AI 价值无法触达；商业化 demo 时根本展示不出来。

2. **零键盘快捷键 + 零批量操作** — `grep onKeyDown shortcut hotkey rowSelection` 全空。
   - Linear 用 C/A/L/F 让你不碰鼠标，我们必须每次"点开 Drawer → Tab Tab Tab → Submit"。
   - 攻关列表 100 条要批量改"已关闭"？必须一条一条点。
   - 内部工具用户 KPI 是"每天处理多少单"，零批量 = 效率折半。

3. **菜单一级项 10 个 + 嵌套 3 层** — AppLayout.tsx:92-175。一级: 作战态势 / 攻关管理 / 人员与荣誉 / 求助中心 / 文档中心 / 全局搜索 / 知识图谱 / 问题反馈 / 帮助中心 / 系统管理 = **10 项**。"系统管理 → 审核管理 → 关系审批" 需要 3 级展开。Linear 一级菜单 4 项，Jira 6 项。
   - 建议合并: "求助 / 文档 / 帮助" 合成"协作中心"；"全局搜索 / 知识图谱" 合成"探索"；"问题反馈" 移到 Header Dropdown（这已经是悬浮按钮了，菜单冗余）。

4. **面包屑 PageBreadcrumb 是硬编码且不全** — `PageBreadcrumb.tsx:4-22` ROUTE_MAP 缺 `/documents` `/manual` `/kg` `/users` `/op-log` `/backup` `/contributions/...` 多个路径。
   - 用户进到 `/kg` 没有面包屑导航。
   - 与"Schema 驱动"的产品哲学矛盾 —— 路由表 ManualCenter.OUTLINE 在另一处也手维护，三处不同步极易腐烂。

5. **Dashboard 没有"今天要做什么"** — `Dashboard.tsx` 只有 4 个 statistic + 最近活跃列表 + 状态分布柱条。
   - 缺 "**分配给我的攻关单**"、"**我关注但有更新的**"、"**SLA 即将超时**"、"**待我审批**"。
   - Linear 的 Home 是 "My Issues / Inbox / Active sprints"，**永远以"我"为中心**。我们的 Dashboard 是"团队总览" → 对个人没有 ToDo 价值。
   - 副作用: 用户登录后第一件事是 → 切到攻关作战台 → 找自己的 → 这个跳跃没有意义。

---

## 短期（2 周）

按"低投入高 ROI"排序:

1. **AI 助手全站浮窗** —  把 `<HermesChat />` 从 KGGraph 提到 AppLayout（与 FloatingFeedback 并列，bottom: 88 已留位）。攻关详情页给一个 ctx-aware placeholder "问关于本攻关单的任何问题"，把 ticketId 注入 hermesAsk。**1 天工作量，差异化曝光率从 5% → 100%。**

2. **Dashboard 改为"我的工作"中心** — 4 个统计卡保留（折叠为 1 行），新增 3 块：
   - 分配给我（`当前处理人 == me`）
   - 我关注（已有 favorites Set 复用）
   - 待审批（admin 可见，proposals 待审批数）
   `0.5 天`

3. **键盘快捷键 v1** —  全站监听:
   - `C` 在攻关列表打开新建 Drawer（覆盖 input focus 时禁用）
   - `/` 聚焦搜索框
   - `Esc` 关闭 Drawer
   - `G then A` 跳攻关 / `G then P` 跳人员（Linear 风格 leader key）
   显示提示: Header 右侧加 "⌘?" 按钮弹 Modal 列快捷键。**3 天。**

4. **批量操作 v1** — AttackList Table 加 `rowSelection`；选中后顶部出现工具条："批量改状态 / 批量分配 / 批量导出 / 取消选择"。**2 天。**

5. **菜单瘦身** —  "问题反馈" 移到 Header 右上 Dropdown（与悬浮反馈按钮去重）；"求助 / 文档 / 帮助 / 知识图谱 / 全局搜索" 合并为 "协作与知识" 二级菜单。**0.5 天。**

6. **面包屑改为路由树自动生成** — 替换 ROUTE_MAP 为基于 routes 配置的自动派生，确保 100% 路由有面包屑。**1 天。**

7. **Dashboard 加产品 Tour** — react-joyride，首次登录 5 步引导。**1 天。**

**两周可完成 = 约 9 人天，1 个前端全力。**

---

## 中期（1-2 月）

1. **多视图引擎（Table / Kanban / Calendar）** — 攻关作战台已经有 Schema，加 Kanban (按"状态"分列)、Calendar (按"创建时间")两种视图。Notion 的核心吸引力来自此。**Linear 的 Triage / Sprints 都是 Kanban 看板。**

2. **AI 助手深度集成**:
   - 攻关详情 AI 提供 "**总结目前进展**" / "**起草日报**" / "**找类似历史攻关**" / "**生成下一步计划**" 4 个 quick action。
   - Schema 字段提供 AI 填充建议（输入"标题"后自动建议"客户名称"、"问题级别"基于历史相似单）。
   - InfoSquare 公告发布前 AI 校对 + 严重程度建议。

3. **SLA 时钟 + Escalation 可视化** — 攻关详情 status 旁加 "P1: 30min 内响应 / 当前已用 12min" 倒计时；超时自动变红 + 推送提醒。**这是 PagerDuty 用户唯一不能没有的功能**，我们后端已有 escalation 但 UI 没暴露。

4. **i18n 框架 + 英文化** — 用 react-i18next，先把 UI 文案抽出（中文枚举值按规范保持），英文版让外籍员工/海外测试用。中长期商业化必备。

5. **协作信号 — 在线状态 / 评论 / @mention** — Linear/Notion 的"几人正在看这个"、详情页评论与 @mention 触发通知。我们的"求助网络" 是树形指派，但缺 inline 讨论。

6. **手机版 / 平板适配审查** — 现在 collapsed sidebar 在 768px 以下触发，但 Dashboard 的 Statistic Row gutter [16, 16] 和 attackDetail 的 Row span=18 / 6 在 iPad 竖屏会很挤；很多 Drawer width=520 也超过手机屏宽。

7. **关注 → 通知中心** — 关注的攻关单有更新/状态流转/新进展时，Header 加 BellOutlined Badge，点开 Inbox 列表（复用现有 ProgressLog + filterKeyAudits）。**Linear/Notion 都是这样建立 stickiness 的。**

8. **可访问性最低标线** — 所有 Button/IconOnly 加 aria-label；颜色 + 图标双编码（状态除了 Tag 色 也加 dot/icon）；登录页对比度从 secondary text 改为 normal 灰；增加键盘 focus 可见 outline。

---

## 产品策略建议（作为 PM）

### 这套是什么？
**"AI-native 内部应急/项目协作平台 with 知识图谱"** — 不是 Jira 替代品，是 **"Jira + Notion + PagerDuty + Glean(内部搜索)"** 的内核耦合。

### 商业化路径（3 选 1）

**路径 A: 行业垂直 SaaS — 通信/IT/制造业的"应急作战平台"**
- TAM: 中大型企业 IT/运维/产品团队，国内 10K+ 家公司有这类痛点。
- 差异化: 配置驱动（不需要 Salesforce 那种半年实施周期）、KG 派生（不需要客户手动维护关系）、中文母语（飞书/钉钉的友好接入）。
- 竞品: 飞书项目 / 钉钉宜搭 / Jira。我们的优势是 **AI 助手 + KG**，劣势是品牌力。
- 定价: 50-200/用户/月，年付。

**路径 B: 开源 + 企业版双轨**
- 类比 Linear（闭源 SaaS）的反面 — 走 Mattermost / GitLab 模式。
- Schema-driven 部分开源吸引社区贡献"行业模板"（攻关单 / 客户工单 / 产品 issue / 项目任务 / OKR）。
- 企业版含: Hermes AI 高级模型、企业级 SSO、合规审计导出、高并发集群。
- 优势: 开发者口碑驱动，0 营销成本；劣势: 现金流慢。

**路径 C: API + Embed — 不做 UI 大战，做"配置驱动 KG 后端 + AI"的 BaaS**
- 复用现有 backend（94 个日志点 + 50+ API + KG + Hermes），上面套 LowCode 工作台。
- Notion-style "Database-as-a-Service" + "AI-on-Your-Data"。
- 受众: 内部工具开发者、低代码平台、ISV。
- 优势: 避开 SaaS UI 红海；劣势: 销售周期长，需要开发者关系投入。

### 最强建议路径: **A (行业垂直) + AI 作为唯一杀招**

理由:
1. 现有产品已经 **完成度 70%**，再投 3 个月就能拿到首批 5-10 家 paying customer。
2. **AI + KG 是真壁垒** — 竞品（飞书/钉钉/Jira）追上 KG 需要 12-18 个月。
3. 中文母语优势 + 信创需求 = 可以拿政府/国企/电信运营商订单（这是飞书拿不下的）。

### Go-to-Market 三步

1. **2 周内**: 短期 7 条全做完，Dashboard 改造 + AI 全站化 + 键盘流，让产品在 demo 时"看起来像 2026 年的产品"。
2. **1 月内**: 找 3 家内部团队做 beta（用户的公司 + 友商 IT 部门），收集真实场景 fix 50 个细节。**录 3 个 demo 视频**，重点突出"5 分钟搭一个新表 / AI 一句话查跨表关联 / 私密协作"三件事。
3. **3 月内**: 行业垂直化打磨——电信运营商场景的"作战值班"模板、互联网公司的"线上故障复盘"模板、制造业的"质量事件追溯"模板。每个模板含: 预置 Schema + 预置概念锚点 + 预置 ConfigCenter 枚举 + AI prompt 调教。模板即销售入口。

### 风险与提醒
- 最大风险: **"功能太丰富导致 onboarding 失败"**。Notion 的早年也吃过这亏。短期必须做引导 + 模板化 + 默认简化视图。
- 次大风险: **AI 体验**。Hermes 后端需要持续投入 prompt + 检索质量。建议绑 Anthropic Claude + 自建向量索引，don't try to roll your own LLM。
- 第三风险: **跨国/英文场景缺位** — 如果走 Path A，国内市场天花板 50M ARR，要冲到 200M+ 必须英文。i18n 框架要在 Q3 前上。

---

**结语**: 这是一个 **底子非常厚** 的产品，被严肃打磨过，工程 craftmanship 在线，但 **产品视觉认知层** 还差一口气。把 AI 助手全站化 + Dashboard 改"以我为中心" + 引入键盘流，这三件做完，产品立刻进入 8.5/10 区间，可以面向客户 demo。再加 Kanban 多视图 + SLA 时钟，9/10 不是梦。

— 评审人 @ 2026-05-30
