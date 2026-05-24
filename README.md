# 作战管理平台 (Combat Platform)

攻关联调作战管理工具——统一的攻关任务跟踪、人员管理、荣誉体系、求助系统和审计日志平台。

## 架构概览

```
packages/shared/      # @combat/shared — 共享类型、接口定义
apps/backend/         # @combat/backend — Express API (SQLite, 50+ 接口)
apps/frontend/        # 参考前端（只读，不可修改）
apps/frontend-v2/     # 新版专业前端 (React 18 + Ant Design 5)
config/schemas/       # 16+ 实体的 JSON Schema 配置（零 DDL 迁移）
scripts/deploy-v2/    # 部署脚本（经跳板机部署到目标服务器）
```

## 技术栈

| 层 | 技术 |
|---|------|
| 后端 | Node.js 22 + Express + better-sqlite3 + TypeScript 5 (ESM) |
| 前端 | React 18 + Vite 6 + Ant Design 5 + react-router-dom 6 + TypeScript 5 |
| 测试 | Vitest (后端 276 个 e2e 测试) + Playwright (前端 e2e) |
| 部署 | SSH2 跳板机部署 → Ubuntu 目标服务器 |

## 核心功能

### 攻关作战台
- 攻关单 CRUD，30+ 字段，状态流转（待响应→处理中→进行中→已解决→已关闭）
- 进展时间线，实时追加，自动快照状态
- 找帮手智能推荐（基于历史贡献相似度匹配）
- 攻关单导入/导出 Excel，dryRun 预览

### 全员名单
- 人员 CRUD + Excel 批量导入导出
- 同名人员合并（实体解析，不可逆，审计记录）
- 部门筛选、搜索

### 贡献与荣誉
- 贡献录入（核心/关键/普通，加权 8/3/1）
- 荣誉殿堂排行榜，个人贡献档案
- 周期筛选

### 求助系统
- 发起求助 → 自动发送邮件 → 对方点击链接填写反馈 → 自动录入攻关单进展
- `help_requests` 表，4 个 API，公开反馈页（无需登录）
- 依赖 SMTP 配置

### 系统管理
- 数据导入/导出（多实体类型，dryRun 预览）
- 邮件 SMTP 配置 + 测试发送
- 完整审计日志（所有变更操作可追溯）
- 角色 RBAC（普通/Leader/管理员）

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

# 后端 e2e 测试 (276 个)
npm run test:backend

# 共享类型测试
npm run test:shared

# 前端 e2e 测试 (Playwright)
cd apps/frontend-v2 && npx playwright install chromium && npx playwright test
```

### 生产构建

```bash
# 构建前端
npm run build:frontend-v2
```

生产环境由后端 Express 在 3001 端口同时托管前端静态文件，单端口部署。

## 部署

目标服务器 `60.204.199.234`，需通过跳板机 `47.103.99.229` 中转。

```bash
cd scripts/deploy-v2
npm install                    # 首次安装 ssh2 依赖

# 检查目标机状态
node deploy.mjs check

# 一键部署（打包 → 跳板机 → 目标机 → npm install → 构建前端 → 启动后端）
node deploy.mjs deploy
```

部署内容：
- 后端：`tsx src/server.ts`，监听 `0.0.0.0:3001`
- 前端：Vite 构建产物由 Express 托管在 3001 端口
- 自动安装 Node.js v22.14.0（`/opt/node22-v2/`，兼容 better-sqlite3）

## API 概览

| 类别 | 示例端点 | 说明 |
|------|----------|------|
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
| 邮件 | `PUT /api/email/config` / `POST /api/email/send` | SMTP 配置与发送 |

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

## 项目结构

```
├── apps/
│   ├── backend/           # Express 后端
│   │   ├── src/
│   │   │   ├── app.ts            # Express 应用工厂
│   │   │   ├── server.ts         # 入口（含前端静态托管）
│   │   │   ├── help-request.ts   # 求助系统模块
│   │   │   ├── support-node.ts   # 资源变动追踪模块
│   │   │   └── ...               # 50+ 模块
│   │   └── test/                 # 276 个 Vitest e2e 测试
│   ├── frontend/          # 参考前端（只读）
│   └── frontend-v2/       # 新版专业前端
│       ├── src/
│       │   ├── api.ts            # API 客户端（25+ 方法）
│       │   ├── layouts/          # 可折叠侧边栏布局
│       │   ├── pages/            # 12 个页面
│       │   └── components/       # 共享组件
│       └── e2e/                  # Playwright e2e 测试
├── packages/
│   └── shared/            # 共享类型包
│       └── src/types.ts          # 所有类型定义
├── config/
│   └── schemas/           # 16+ JSON Schema 文件
├── scripts/
│   └── deploy-v2/         # 部署脚本
│       ├── deploy.mjs           # 主部署脚本
│       └── run-backend.sh       # 目标机启动脚本
├── docs/
│   ├── API_REFERENCE.md
│   ├── DESIGN.md
│   └── USER_MANUAL.md
├── AGENTS.md              # 开发指引
├── FRONTEND_V2_DESIGN.md  # 前端设计文档
└── SYSTEM_REFERENCE.md    # 系统参考文档
```

## License

Private — Internal Use Only
