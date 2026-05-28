# 作战管理平台 (Combat Platform)

攻关联调作战管理工具——统一的攻关任务跟踪、人员管理、荣誉体系、求助系统和审计日志平台。

线上地址：http://124.156.193.122:3001/ （默认登录 `admin` / `admin123`）

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

| 层 | 技术 |
|---|------|
| 后端 | Node.js 22 + Express + better-sqlite3 + TypeScript 5 (ESM) |
| 前端 | React 18 + Vite 6 + Ant Design 5 + react-router-dom 6 + TypeScript 5 |
| 前端增强 | react-resizable（列宽拖拽）+ @dnd-kit（列顺序拖拽） |
| 认证 | JWT (7天过期) + bcrypt 密码哈希 + RBAC 角色（normal/leader/admin） |
| 测试 | Vitest (后端 315 个 e2e 测试) + Playwright (前端 e2e) |
| 部署 | 直连 SSH → Ubuntu 目标服务器 (systemd 管理) |

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
- 角色 RBAC（普通/Leader/管理员）
- 数据库备份与恢复

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

| 类别 | 示例端点 | 说明 |
|------|----------|------|
| 认证 | `POST /api/auth/login` / `POST /api/auth/register` | JWT 登录注册 |
| 通用 CRUD | `GET/POST /api/nodes/:nodeType` | 配置驱动，16+ 实体类型 |
| 单条操作 | `GET/PUT/DELETE /api/nodes/:id` | 读取/更新/删除 |
| 进展时间线 | `GET/POST /api/nodes/:id/progress` | 追加进展 |
| 状态流转 | `POST /api/nodes/:id/transition` | 状态机转换 |
| 找帮手 | `GET /api/recommend/helpers/:id` | 智能推荐 |
| 荣誉排行 | `GET /api/honor/leaderboard` | 加权排行榜 |
| 仪表盘 | `GET /api/dashboard` | 态势概览 |
| 求助系统 | `POST /api/help-requests` | 创建求助+发邮件 |
| 反馈提交 | `POST /api/help/feedback/:token` | 公开反馈（无需登录） |
| 导入导出 | `POST /api/import` / `GET /api/export/:type` | Excel 导入导出 |
| Schema | `GET/PATCH /api/schema/:nodeType` | 动态字段管理 |
| 审计日志 | `GET /api/audit` | 全量操作审计 |
| 操作日志 | `GET /api/op-logs` | 前端操作追踪 |
| 邮件 | `PUT /api/email/config` / `POST /api/email/send` | SMTP 配置与发送 |
| 问题反馈 | `GET/POST /api/bug-reports` | Bug 报告（POST 无需登录） |
| 用户管理 | `GET/POST /api/auth/users` | 管理员用户 CRUD |
| 备份 | `GET /api/backup` / `POST /api/backup/restore` | 数据库备份恢复 |
| 配置中心 | `GET/PUT /api/settings` | 运行时配置管理 |

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

| 页面 | 路由 | 说明 |
|------|------|------|
| 仪表盘 | `/` | 作战态势概览 |
| 攻关列表 | `/attack` | 攻关单 CRUD + 筛选 + 导出 |
| 攻关详情 | `/attack/:id` | 进展时间线 + 求助 + 找帮手 |
| 全员名单 | `/people` | 人员管理 + 导入导出 |
| 贡献录入 | `/contributions` | 贡献 CRUD |
| 荣誉殿堂 | `/honor` | 排行榜 + 个人档案 |
| 求助中心 | `/help` | 求助记录管理 |
| 求助反馈 | `/help/feedback/:token` | 公开反馈页（无需登录） |
| 导入导出 | `/import` | Excel 批量导入导出 |
| 邮件设置 | `/email` | SMTP 配置 |
| 审计日志 | `/audit` | 全量操作审计 |
| 操作日志 | `/op-log` | 前端操作追踪 |
| 配置中心 | `/config` | 运行时配置管理 |
| 用户管理 | `/users` | 管理员用户 CRUD |
| 问题反馈 | `/bug-report` | Bug 提交 + 截图 |
| 攻关日报 | `/daily-report` | 当日进展日报 |
| 登录页 | `/login` | JWT 登录 |

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

## 测试状态（2026-05-28）

- **315/315** 后端 Vitest 测试通过（51 test files）
- **13/13** 攻关页面 Playwright 测试通过
- **8/8** 人员页面 Playwright 测试通过
- 全量 368 e2e 套件因资源超时偶现 worker 崩溃（非代码问题）

## License

Private — Internal Use Only
