# 作战管理平台 (Combat Platform)

攻关联调作战管理工具——统一的攻关任务跟踪、人员管理、荣誉体系、求助系统和审计日志平台。

线上地址：http://124.156.193.122:3001/

## 🚀 新人 5 分钟跑起来

```bash
# 1. clone + 装依赖（npm workspaces，会拉所有 workspace 包）
git clone https://github.com/l17728/combat-platform.git
cd combat-platform
npm install

# 2. 开两个 terminal 各跑一个
npm run dev:backend       # 后端 :3001 (tsx watch)
npm run dev:frontend-v2   # 前端 :5174 (vite dev,代理 /api 到 3001)

# 3. 浏览器打开 http://localhost:5174
```

第一次跑：后端在 `apps/backend/combat.sqlite` 自动建库 + seed 默认 admin；前端 vite 自动热更新。

### 进阶

- **后端测试**：`npm run test:backend`（vitest e2e）
- **前端 e2e**：`npx playwright test --config=apps/frontend-v2/playwright.config.ts`（~14min 全套）
- **CLI 工具**：`npm run cli -- help`（每个 HTTP API 都有对应 CLI 命令）
- **配置 schema**：`config/schemas/*.json`（加字段是配置改动，不是 DDL 迁移）
- **切 Postgres**：设 `DB_URL=postgres://...`，详见 [docs/POSTGRES_SUPPORT.md](docs/POSTGRES_SUPPORT.md)

### 必读文档（按上手优先级）

1. [CLAUDE.md](CLAUDE.md) — 13 条核心原则 + 项目宪法
2. [AGENTS.md](AGENTS.md) — 累积 hard-won 经验
3. [docs/POSTGRES_SUPPORT.md](docs/POSTGRES_SUPPORT.md) — Postgres 切换路线图
4. [docs/REVIEWS/](docs/REVIEWS/) — 5 位顶级专家盲审报告
5. [docs/BLOG*技术评审*作战平台.md](docs/BLOG_技术评审_作战平台.md) — 5 篇 review 重写的深度科普博客

## 架构概览

```
packages/shared/      # @combat/shared — 共享类型、接口定义
apps/backend/         # @combat/backend — Express API (SQLite, 50+ 接口)
apps/frontend/        # 参考前端（只读，不可修改）
apps/frontend-v2/     # 新版专业前端 (React 18 + Ant Design 5)
config/schemas/       # 16+ 实体的 JSON Schema 配置（零 DDL 迁移）
scripts/deploy-v2/    # 部署脚本（直连 SSH 部署到目标服务器）
```

## 技术栈

| 层       | 技术                                                                                    |
| -------- | --------------------------------------------------------------------------------------- |
| 后端     | Node.js 22 + Express + better-sqlite3 + TypeScript 5 (ESM)                              |
| 前端     | React 18 + Vite 6 + Ant Design 5 + react-router-dom 6 + TypeScript 5                    |
| 前端增强 | react-resizable（列宽拖拽）+ @dnd-kit（列顺序拖拽）                                     |
| 认证     | JWT (7天过期) + bcrypt 密码哈希 + RBAC 角色（normal/leader/admin/superadmin）+ 游客只读 |
| 测试     | Vitest (后端 821 个 e2e 测试) + Playwright (前端 e2e)                                   |
| 部署     | 直连 SSH → Ubuntu 目标服务器 (systemd 管理)                                             |

## 核心功能

### 攻关作战台

- 攻关单 CRUD，30+ 字段，状态流转（待响应→处理中→进行中→已解决→已关闭）
- 进展时间线，实时追加，自动快照状态
- 找帮手智能推荐（基于历史贡献相似度匹配）
- 攻关单导入/导出 Excel，dryRun 预览
- 字段筛选（多选 OR 逻辑）+ 表格列宽拖拽 + 列顺序拖拽

### 全员名单

- 人员 CRUD + Excel 批量导入导出
- 同名人员合并（实体解析，不可逆，审计记录）
- 部门筛选、搜索

### 贡献与荣誉

- 贡献录入（核心/关键/普通，加权 8/3/1）
- 荣誉殿堂排行榜（个人 + 团队），个人贡献档案
- 周期筛选

### 求助系统

- 发起求助 → 自动发送邮件 → 对方点击链接填写反馈 → 自动录入攻关单进展
- `help_requests` 表，4 个 API，公开反馈页（无需登录）
- 依赖 SMTP 配置

### 系统管理

- 数据导入/导出（多实体类型，dryRun 预览）
- 邮件 SMTP 配置 + 测试发送
- 完整审计日志（所有变更操作可追溯）
- 操作日志（前端 API 调用 + 路由导航 + 全局错误自动捕获）
- 用户管理（管理员 CRUD 用户账号）
- 配置中心（运行时下拉选项管理）
- 问题反馈（用户提交 bug + 截图 + Console 日志）
- 角色 RBAC（普通/Leader/管理员/SuperAdmin）
- 游客参观模式（只读三层防护：后端中间件 + API 拦截器 + 组件级 useGuestGuard）
- 数据库备份与恢复

### 共享功能 (v3.0)

- 知识库文章、攻关单、信息广场卡片的外部链接分享（加密短链 + 密码 + 有效期）
- 站内用户共享（搜索选择 + 通知推送）
- 分享管理面板（链接管理 + 访问趋势图）
- 文章复制到攻关单局部知识库
- 公共分享页面 `/s/:token`（无需登录，密码保护）

### SaaS 多租户 (v3.0)

- 多租户架构：`SAAS_MODE=1` 启用，不设则单租户模式，向后兼容
- 平台管理：superAdmin 管理租户 CRUD + 暂停/恢复 + 资源统计
- 租户详情：用户列表 + 资源用量 + 配额进度条
- 注册流程：创建团队 / 加入团队（邀请码）
- Guest 免登录体验：自动创建临时用户，1 天 JWT，**只读参观模式**
- 游客三层防护：后端 `guestReadOnlyMiddleware`（拦截写语义 GET + 全部非 GET）+ 前端 `req()` 拦截器 + 组件级 `useGuestGuard` hook
- 计划配额：free/pro/enterprise 三档（用户数 + 节点数）
- Guest 数据定期清理（24h cron）

## 快速开始

### 环境要求

- Node.js >= 22（better-sqlite3 兼容性要求）
- npm >= 10

### 安装

```bash
git clone https://github.com/l17728/combat-platform.git
cd combat-platform
npm install
```

### 开发

```bash
# 启动后端 (端口 3001)
npm run dev:backend

# 启动新版前端 (端口 5174，API 代理到 3001)
npm run dev:frontend-v2

# 启动参考前端 (端口 5173)
npm run dev:frontend
```

### 测试

```bash
# 运行全部测试
npm run test:all

# 后端 e2e 测试 (315 个)
npm run test:backend

# 共享类型测试
npm run test:shared

# 前端 v2 e2e 测试 (Playwright)
npx playwright test --config=apps/frontend-v2/playwright.config.ts --reporter=line
```

### 生产构建

```bash
# 构建前端
npm run build:frontend-v2
```

生产环境由后端 Express 在 3001 端口同时托管前端静态文件，单端口部署。

## 部署

生产服务器 `124.156.193.122`，直连 SSH 部署（跳板机已废弃）。

```bash
# 前提：所有改动必须先 git commit（deploy 打包 git HEAD）
git add -A && git commit -m "your message"

# 一键部署（直连 SSH → 目标机）
cd scripts/deploy-v2 && node deploy-direct.mjs 124.156.193.122 root <password>

# 查看日志
ssh root@124.156.193.122 'tail -f /opt/combat-v2/backend.log'
```

部署内容：

- 后端：`tsx src/server.ts`，监听 `0.0.0.0:3001`
- 前端：Vite 构建产物由 Express 托管在 3001 端口
- systemd 服务：`combat-v2.service`，自动重启，开机自启
- Node.js v22.22.3（通过 nvm 管理，兼容 better-sqlite3）

## CLI 工具

```bash
npm run cli -- <command> [args] [--opts]   # 读取 COMBAT_API env (默认 http://localhost:3001)
npm run cli -- help                        # 列出所有命令
```

主要命令：`nodes:list`, `nodes:create`, `nodes:update`, `schema:get`, `auth:login`, `users:list`, `honor:leaderboard`, `op-logs:list`, `audit:recent`

## API 概览

| 类别       | 示例端点                                           | 说明                      |
| ---------- | -------------------------------------------------- | ------------------------- |
| 认证       | `POST /api/auth/login` / `POST /api/auth/register` | JWT 登录注册              |
| 通用 CRUD  | `GET/POST /api/nodes/:nodeType`                    | 配置驱动，16+ 实体类型    |
| 单条操作   | `GET/PUT/DELETE /api/nodes/:id`                    | 读取/更新/删除            |
| 进展时间线 | `GET/POST /api/nodes/:id/progress`                 | 追加进展                  |
| 状态流转   | `POST /api/nodes/:id/transition`                   | 状态机转换                |
| 找帮手     | `GET /api/recommend/helpers/:id`                   | 智能推荐                  |
| 荣誉排行   | `GET /api/honor/leaderboard`                       | 加权排行榜                |
| 仪表盘     | `GET /api/dashboard`                               | 态势概览                  |
| 求助系统   | `POST /api/help-requests`                          | 创建求助+发邮件           |
| 反馈提交   | `POST /api/help/feedback/:token`                   | 公开反馈（无需登录）      |
| 导入导出   | `POST /api/import` / `GET /api/export/:type`       | Excel 导入导出            |
| Schema     | `GET/PATCH /api/schema/:nodeType`                  | 动态字段管理              |
| 审计日志   | `GET /api/audit`                                   | 全量操作审计              |
| 操作日志   | `GET /api/op-logs`                                 | 前端操作追踪              |
| 邮件       | `PUT /api/email/config` / `POST /api/email/send`   | SMTP 配置与发送           |
| 问题反馈   | `GET/POST /api/bug-reports`                        | Bug 报告（POST 无需登录） |
| 用户管理   | `GET/POST /api/auth/users`                         | 管理员用户 CRUD           |
| 备份       | `GET /api/backup` / `POST /api/backup/restore`     | 数据库备份恢复            |
| 配置中心   | `GET/PUT /api/settings`                            | 运行时配置管理            |

完整 API 文档见 `docs/API_REFERENCE.md`。

## 配置驱动 Schema

实体定义在 `config/schemas/*.json`，无需数据库迁移：

```json
{
  "nodeType": "attackTicket",
  "label": "攻关单",
  "fields": [
    { "name": "标题", "type": "text", "required": true },
    { "name": "状态", "type": "select", "enumValues": ["待响应", "处理中", "进行中", "已解决", "已关闭"] }
  ]
}
```

- 运行时通过 `PATCH /api/schema/:nodeType` 动态增删字段
- 业务数据存储在 `nodes` 表的 `properties` JSON 列中

## 前端页面清单（25+）

| 页面     | 路由                    | 说明                       |
| -------- | ----------------------- | -------------------------- |
| 仪表盘   | `/`                     | 作战态势概览               |
| 攻关列表 | `/attack`               | 攻关单 CRUD + 筛选 + 导出  |
| 攻关详情 | `/attack/:id`           | 进展时间线 + 求助 + 找帮手 |
| 全员名单 | `/people`               | 人员管理 + 导入导出        |
| 贡献录入 | `/contributions`        | 贡献 CRUD                  |
| 荣誉殿堂 | `/honor`                | 排行榜 + 个人档案          |
| 求助中心 | `/help`                 | 求助记录管理               |
| 求助反馈 | `/help/feedback/:token` | 公开反馈页（无需登录）     |
| 导入导出 | `/import`               | Excel 批量导入导出         |
| 邮件设置 | `/email`                | SMTP 配置                  |
| 审计日志 | `/audit`                | 全量操作审计               |
| 操作日志 | `/op-log`               | 前端操作追踪               |
| 配置中心 | `/config`               | 运行时配置管理             |
| 用户管理 | `/users`                | 管理员用户 CRUD            |
| 问题反馈 | `/bug-report`           | Bug 提交 + 截图            |
| 攻关日报 | `/daily-report`         | 当日进展日报               |
| 登录页   | `/login`                | 登录/注册 + 免登录体验     |
| 公共分享 | `/s/:token`             | 分享内容查看（无需登录）   |
| 平台管理 | `/platform`             | 租户管理（superAdmin）     |
| 租户详情 | `/platform/tenants/:id` | 租户详情（superAdmin）     |

## 项目结构

```
├── apps/
│   ├── backend/           # Express 后端
│   │   ├── src/
│   │   │   ├── app.ts            # Express 应用工厂
│   │   │   ├── server.ts         # 入口（含前端静态托管）
│   │   │   ├── auth.ts           # JWT 认证 + 用户管理
│   │   │   ├── routes.ts         # 通用节点 CRUD + schema
│   │   │   ├── help-request.ts   # 求助系统模块
│   │   │   ├── op-log.ts         # 操作日志模块
│   │   │   ├── support-node.ts   # 资源变动追踪模块
│   │   │   └── ...               # 50+ 模块
│   │   └── test/                 # 315 个 Vitest e2e 测试
│   ├── frontend/          # 参考前端（只读）
│   └── frontend-v2/       # 新版专业前端
│       ├── src/
│       │   ├── api.ts            # API 客户端（40+ 方法）
│       │   ├── hooks/            # useAuth, useSettings, useFlexTable 等
│       │   ├── layouts/          # 可折叠侧边栏布局
│       │   ├── pages/            # 25+ 页面
│       │   └── components/       # 共享组件
│       └── e2e/                  # Playwright e2e 测试
├── packages/
│   └── shared/            # 共享类型包
│       └── src/types.ts          # 所有类型定义
├── config/
│   └── schemas/           # 16+ JSON Schema 文件
├── scripts/
│   ├── deploy-v2/         # 部署脚本
│   │   ├── deploy-direct.mjs     # 直连 SSH 部署（推荐）
│   │   └── deploy.mjs            # 跳板机部署（已废弃）
│   └── mock-data/         # 数据填充脚本
│       ├── demo-seed.mjs         # 演示数据
│       └── wipe.mjs              # 数据清除
├── docs/
│   ├── API_REFERENCE.md
│   ├── DESIGN.md
│   └── USER_MANUAL.md
├── AGENTS.md              # 开发指引
├── CLAUDE.md              # Claude Code 指引
├── FRONTEND_V2_DESIGN.md  # 前端设计文档
└── SYSTEM_REFERENCE.md    # 系统参考文档
```

## 测试状态(2026-06-04, v3.0.1)

- **821/821** 后端 Vitest 通过(102 test files)
- **28/28** shared vitest 通过
- Frontend tsc 0 错
- Frontend e2e:多视图 12 + schema-driven 25 + 抽屉/详情回归 47+ 全绿
- **Hermes LLM 端到端 golden set 15/15 通过**(模型 glm-4-flash + thinking disabled)
- Guest UI regression: 18/18 pages PASS, 0 writes succeeded

## 当前版本

- **v3.0.1** — Guest 只读三层防护 + SuperAdmin auto-promotion + 品牌更名「会战管理」 + 登录页安全加固
- **v3.0.0** — 共享功能 + SaaS 多租户架构
- 完整版本历史见 [docs/ROADMAP.md](docs/ROADMAP.md)

### 已交付里程碑

| 版本       | 主题                                           |
| ---------- | ---------------------------------------------- |
| v2.0       | Welink + Postgres + UI 配置化                  |
| v2.1       | Roadmap 4 桶整合(安全/性能/UX/质量)            |
| v2.2       | P1 三桶(sec/perf/quality)                      |
| v2.3       | 一键升级 UI + Schema overlay                   |
| v2.3.1     | 现网加固 + 架构韧性 + 升级真实化               |
| v2.3.2     | Hot-fix React #310 + AI 抖动                   |
| v2.3.3     | Hermes Tool-using Agent + 14 通用工具          |
| v2.3.4     | LLM 端到端 + Inbox + 面包屑 + Schema-as-UI     |
| v2.3.5     | Hermes 体验收尾 + Schema-as-UI 全栈化 + 多视图 |
| v2.3.6     | Hermes 写工具 + 会话记忆                       |
| v2.3.7     | 暗黑模式 + 产品引导 + 看板配置                 |
| v2.3.8     | Webhook 事件订阅 + 邮件摘要 + 内联字段         |
| v2.3.9     | 邮件增强 + 邀请管理 + 运营大屏                 |
| v2.3.10    | 知识库 Wiki + API 自动文档 + 前端代码拆分      |
| v2.8.0     | 知识图谱可视化 + 边类型中文重命名              |
| v2.9.0     | 知识库大版本 + Markdown 渲染引擎               |
| **v3.0.0** | **共享功能 + SaaS 多租户架构**                 |

## License

Private — Internal Use Only
