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

## 未来规划(v3.0)

### 标准节奏(5 版本到 v3.0)

| 版本 | 主题                  | 主要内容                                                                                          |
| ---- | --------------------- | ------------------------------------------------------------------------------------------------- |
| v3.0 | **多租户 + 行级权限** | 真多租户隔离(SaaS 化)、组织/团队/项目维度行级权限、租户 quota/配额                                |
| v3.1 | **性能 P2**           | Postgres 多副本部署、全链路 trace(OpenTelemetry)、CDN/edge 缓存、前端 code-splitting、bundle 减重 |
| v3.2 | **安全 P2**           | 完整渗透测试(10 用例真跑)、MFA 多因素认证、审计 Merkle 根公示、密码策略+锁定、WAF                 |
| v3.3 | **集成生态**          | IM 集成(钉钉/企业微信/飞书)、移动端 PWA 适配                                                      |
| v3.4 | **业务延展**          | 工作流引擎(BPMN-light)、自定义报表设计器、知识库/Wiki、API 自动文档(OpenAPI 渲染)、i18n、a11y     |

### 全量特性清单（21 项）

| #   | 分类 | 特性                        | 规划版本 | 说明                               |
| --- | ---- | --------------------------- | -------- | ---------------------------------- |
| 1   | 架构 | 多租户隔离(SaaS 化)         | v3.0     | schema 隔离 + 数据隔离 + 租户管理  |
| 2   | 架构 | 行级权限(RBAC → ABAC)       | v3.0     | 组织/团队/项目维度细粒度控制       |
| 3   | 架构 | 租户 quota/配额管理         | v3.0     | 节点数/存储/API 调用限制           |
| 4   | 性能 | Postgres 多副本部署         | v3.1     | 读写分离、连接池优化               |
| 5   | 性能 | 全链路 trace(OpenTelemetry) | v3.1     | HTTP → DB → LLM 全链路可观测       |
| 6   | 性能 | CDN/edge 缓存               | v3.1     | 静态资源 + 配置中心响应缓存        |
| 7   | 性能 | 前端 code-splitting         | v3.1     | 路由级懒加载，首屏 bundle 减重     |
| 8   | 性能 | Bundle 减重                 | v3.1     | Tree-shaking + 依赖审计            |
| 9   | 安全 | 完整渗透测试(10 用例真跑)   | v3.2     | OWASP Top 10 全覆盖                |
| 10  | 安全 | MFA 多因素认证              | v3.2     | TOTP/短信二次验证                  |
| 11  | 安全 | 审计 Merkle 根公示          | v3.2     | 防篡改验证接口                     |
| 12  | 安全 | 密码策略+锁定               | v3.2     | 复杂度规则 + 连续失败锁定          |
| 13  | 安全 | WAF                         | v3.2     | SQL 注入/XSS/CC 攻击防护           |
| 14  | 集成 | IM 集成(钉钉/企业微信/飞书) | v3.3     | 消息推送 + 审批回调                |
| 15  | 集成 | 移动端 PWA 适配             | v3.3     | Service Worker + 离线 + 安装到桌面 |
| 16  | 业务 | 工作流引擎(BPMN-light)      | v3.4     | 可视化审批流 + 条件分支            |
| 17  | 业务 | 自定义报表设计器            | v3.4     | 拖拽式图表 + 导出 PDF              |
| 18  | 业务 | 知识库/Wiki                 | v3.4     | Markdown 编辑 + 目录树 + 全文搜索  |
| 19  | 业务 | API 自动文档(OpenAPI 渲染)  | v3.4     | Swagger UI 从 routes 自动生成      |
| 20  | UX   | i18n 国际化(中英切换)       | v3.4     | react-intl 全站文案外置            |
| 21  | UX   | a11y 可访问性               | v3.4     | 键盘导航 + ARIA 标签 + 对比度      |

> 以下特性已从 v3.x 移到 v2.12 提前实现：邀请/加入流程、邮件 digest 增强、大屏运营仪表板。

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
