# 作战平台 Roadmap (v2.x → v3.0)

> 维护者:产品/架构组。每次 sprint 落地后更新「已交付」节;v3.0 收口后归档。

## 已交付(v2.0 → v2.11)

| 版本       | 日期           | 主题                                           | 关键成果                                                                                                                       |
| ---------- | -------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| v2.0       | 2026-05-30     | Welink + Postgres + UI 配置化                  | Postgres adapter / Welink 集成 / Settings 表运行时下拉                                                                         |
| v2.1       | 2026-05-31     | Roadmap 4 桶                                   | 安全/性能/UX/质量基线建立                                                                                                      |
| v2.2       | 2026-05-31     | P1 三桶                                        | helmet/CSRF/rate-limit + queryNodesByProperty/Prometheus + AttackDetail 拆分/ApiError/vitest 起手                              |
| v2.3       | 2026-05-31     | 一键升级 UI + Schema overlay                   | UI 上传升级包 + 三方 schema 合并 + detached worker + 自动回滚                                                                  |
| v2.4       | 2026-05-31     | harden + resilience + upgrade-real             | exceljs/PM2/dist/backup/Sentry + KG outbox/Merkle/catch 迁移 + GitHub Release/PGP/prod-rehearsal                               |
| v2.4.1     | 2026-05-31     | Hot-fix                                        | React #310 hooks 顺序 + HermesChat 抖动                                                                                        |
| v2.5       | 2026-05-31     | Hermes Tool-using Agent                        | 14 工具 + filter DSL + 私单收口 + OpenAI tool-calling + golden set 15/15(工具直调)                                             |
| v2.6       | 2026-05-31     | LLM 端到端 + Inbox + 面包屑 + Schema-as-UI     | OpenAICompatibleRunner 直连 + LLM 设置 UI + 通知 Inbox/SSE + BreadcrumbBar + attackTicket schema 驱动                          |
| v2.7       | 2026-06-01     | Hermes 体验收尾 + Schema-as-UI 全栈化 + 多视图 | /models 动态 + /test env-fallback + Q7 prompt + drop-in 自愈 + 7 nodeType schema 驱动 + virtual schema + Kanban/Calendar/Pivot |
| v2.8       | 2026-06-01     | Hermes 高级能力                                | 写工具(create/update/progress) + 会话记忆 + golden set 20/20 + 双 DB 支持                                                      |
| v2.10      | 2026-06-01     | UX 中期 II                                     | 暗黑模式 + 产品 Tour(Dashboard/AttackList/Admin) + Dashboard 看板配置                                                          |
| **v2.11**  | **2026-06-01** | **Webhook + 邮件摘要 + 内联字段**              | **Webhook 事件订阅(11种事件) + 邮件Digest(日/周汇总) + 攻关详情内联添加字段**                                                  |
| **v2.2.0** | **2026-06-01** | **邮件增强 + 邀请管理 + 运营大屏**             | **HTML邮件模板 + 自定义时间段摘要 + 邀请码注册(角色预设) + 深色全屏运营大屏(KPI/状态分布/自动刷新)**                           |

> v2.9(多租户 + 行级权限)跳过,相关需求合并到 v3.0。

## 当前开发(v2.3 — 知识库 + API自动文档 + Code-splitting)

v2.3 三桶特性从原 v3.4/v3.1 中提取，其余 v3.x 特性标记为**不实施**。

| #   | 特性                         | 来源      | 说明                                                                             |
| --- | ---------------------------- | --------- | -------------------------------------------------------------------------------- |
| 1   | **知识库/Wiki**              | v3.4→v2.3 | 全局知识库(Dashboard tab) + 攻关单局部知识库(自定义tab);Markdown编辑+目录树+搜索 |
| 2   | **API自动文档(OpenAPI渲染)** | v3.4→v2.3 | Express routes 自动生成 OpenAPI spec + Swagger UI 渲染                           |
| 3   | **前端 Code-splitting**      | v3.1→v2.3 | React.lazy 路由级懒加载，3.5MB→按需加载，首屏减重                                |

## 暂不实施(v3.x 归档)

以下特性经评估后暂不实施，保留记录备查：

| #   | 特性                        | 原版本 | 不实施原因                      |
| --- | --------------------------- | ------ | ------------------------------- |
| 1   | 多租户隔离(SaaS化)          | v3.0   | 内部部署，无需多租户            |
| 2   | 行级权限(RBAC→ABAC)         | v3.0   | 当前 RBAC 已满足需求            |
| 3   | 租户 quota/配额管理         | v3.0   | 随多租户一起暂缓                |
| 4   | Postgres 多副本部署         | v3.1   | 单机部署，暂不需要              |
| 5   | 全链路 trace(OpenTelemetry) | v3.1   | Sentry 已覆盖基本可观测性       |
| 6   | CDN/edge 缓存               | v3.1   | 内部网络，延迟不是瓶颈          |
| 7   | Bundle 减重                 | v3.1   | v2.3 code-split 已覆盖          |
| 8   | 完整渗透测试(10用例真跑)    | v3.2   | 已有安全基线(v2.2 P1)           |
| 9   | MFA 多因素认证              | v3.2   | 内部系统，密码+JWT 够用         |
| 10  | 审计 Merkle 根公示          | v3.2   | v2.4 已实现 Merkle 链           |
| 11  | 密码策略+锁定               | v3.2   | 当前强制改密+bcrypt 已覆盖      |
| 12  | WAF                         | v3.2   | 内部网络，iptables 已有         |
| 13  | IM 集成(钉钉/企微/飞书)     | v3.3   | 无集成需求                      |
| 14  | 移动端 PWA 适配             | v3.3   | 响应式已基本可用                |
| 15  | 工作流引擎(BPMN-light)      | v3.4   | 状态流转+Webhook 已覆盖审批场景 |
| 16  | 自定义报表设计器            | v3.4   | Dashboard+导出已覆盖报表需求    |
| 17  | i18n 国际化                 | v3.4   | 域语言为中文，无国际化需求      |
| 18  | a11y 可访问性               | v3.4   | AntD 5 自带基础 a11y            |

> 以下特性已从 v3.x 移到 v2.x 提前实现：邀请/加入流程、邮件 digest 增强、大屏运营仪表板(v2.2)；知识库、API自动文档、code-splitting(v2.3)。

## 评估优先级的依据

5 专家 review 评分 + 用户反馈:

| 维度     | v2.0 baseline | v2.7 当前 | 目标 v3.0 |
| -------- | ------------- | --------- | --------- |
| 架构     | 8.0/10        | 8.5/10    | 9.0/10    |
| 代码质量 | 7.4/10        | 8.5/10    | 9.0/10    |
| UX       | 7.0/10        | 8.5/10    | 9.0/10    |
| 性能     | 4.0/10        | 7.0/10    | 8.5/10    |
| 安全     | 3.0/10        | 7.0/10    | 8.5/10    |

## 已 land 的主题(不再追加,稳定运营)

- ✅ Welink 集成(v2.0)
- ✅ Postgres adapter(v2.0)
- ✅ helmet/CSRF/rate-limit/AES 加密(v2.2/v2.6)
- ✅ KG outbox + worker 可重放(v2.4)
- ✅ audit Merkle 链(v2.4)
- ✅ Sentry 错误聚合(v2.4)
- ✅ 一键升级 UI + Schema overlay(v2.3)
- ✅ Hermes Tool-using Agent + 14 工具(v2.5)
- ✅ LLM UI 配置 + AES apiKey(v2.6)
- ✅ 站内 Inbox + SSE(v2.6)
- ✅ BreadcrumbBar(v2.6)
- ✅ Schema-as-UI 全栈(v2.6 attackTicket + v2.7 7 nodeType)
- ✅ 多视图 Kanban/Calendar/Pivot(v2.7)
- ✅ deploy-direct.mjs drop-in 自愈(v2.7)

## 节奏与团队约束

- 当前节奏: 1 sprint ≈ 1-3 小时(4 worktree 并行 sub-agent)
- 标准节奏 8 版本 → 估 1-2 周内全部交付
- 缩减节奏 5 版本 → 估 1 周内
- 每版 sprint 完毕硬约束: 文档全刷新(release notes + help-content 8+ 章节 + AGENTS.md + 受影响 docs/\*.md)
