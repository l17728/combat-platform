# 版本发布说明

## v3.1.0 (2026-06-07) — 权限安全全面加固 + 举一反三

### 🔒 权限边界修复（7 项）

从 185 个 e2e 测试的举一反三审计中发现并修复 7 个权限安全问题：

1. **前端路由 Guard 缺失** — 11 个系统管理路由缺少 `AdminGuard`（App.tsx），normal user 可直接访问系统管理页面
2. **侧边栏菜单未隔离** — 系统管理菜单对 normal user 可见，未按角色条件渲染（AppLayout.tsx）
3. **settings.ts 无 adminMiddleware** — GET/PUT/DELETE `/api/settings` 全部端点缺少权限检查
4. **schema 写操作无 adminMiddleware** — POST `/schema/scan`、PATCH `/schema/:type`、POST `/schema/nodeType`、DELETE `/schema/nodeType/:type` 缺少权限检查
5. **import.ts 无 adminMiddleware** — POST `/api/import` 缺少权限检查
6. **hermes-tools-router.ts 无 adminMiddleware** — POST `/api/hermes/tool/:name` 缺少权限检查
7. **Guest 修改密码入口可见** — 密码修改菜单未对 guest 角色隐藏

### 🐛 Bug 修复

- **Guest 作战态势页卡住** — `proposals` 表缺少 `tenant_id` 列导致查询抛出未捕获异常，整个 `/api/dashboard` 请求挂起无响应。根因：`db.ts` 的 `saasTables` 迁移列表遗漏 `proposals` 表。修复：将 `proposals` 加入迁移列表 + `dashboard.ts` 增加 try/catch 防御

### 🛡️ 安全架构改进

- **adminMiddleware 逐路由文件覆盖** — 每个路由文件内部显式引入 `adminMiddleware`，而非依赖 app.ts 统一挂载
- **三层一致性验证** — 前端路由 Guard + 侧边栏可见性 + 后端 API middleware 三者必须对齐
- **全量路由审计** — 20+ 后端路由文件逐一审计 adminMiddleware 覆盖情况

### 📊 测试

- 三角色 e2e 测试：185/185 全绿（admin 59 + guest 55 + normal 71）
- 新增 38 个安全边界专项测试（§N16-§N18、§A15、§G13、§G19）
- 举一反三审计：全量表 `tenant_id` 列覆盖检查

### 📝 经验教训（写入 AGENTS.md T1-T5）

- **T1**: 安全边界必须独立测试，不因前端 Guard 通过就假设后端也安全
- **T2**: 每个角色测试套件必须包含负面穷举测试
- **T3**: 前端路由 Guard + 侧边栏可见性 + 后端 API middleware 三层必须对齐
- **T4**: 新增路由文件时必须逐端点审计 adminMiddleware
- **T5**: 举一反三必须递归至零，不允许"应该没问题"就停

### 相关 Commit

| Commit    | 说明                                              |
| --------- | ------------------------------------------------- |
| `d8eef76` | 11 系统 AdminGuard + 侧边栏隔离 + 20 安全边界测试 |
| `6050df7` | 4 路由 adminMiddleware + 10 测试                  |
| `b5ae93b` | Guest 密码菜单隐藏 + 系统 API 只读验证            |

---

## v3.0.1 (2026-06-04) — Guest 只读防护 + 安全加固

### 🔒 Guest 游客三层只读防护

Guest 用户现可浏览所有页面（含系统管理），但**不能执行任何写操作**。防护分三层：

1. **后端 `guestReadOnlyMiddleware`**（`tenant-middleware.ts`）
   - 拦截所有非 GET 请求，返回 403
   - 拦截写语义 GET 路径（数据导出、备份下载等），通过 `GUEST_WRITE_SEMANTIC_GET_TESTS` 可扩展数组定义
   - `isGuest` 标记在 JWT payload 中，不可伪造

2. **前端 API 拦截器**（`api.ts`）
   - `req()` 方法检测 `isGuest`，对非 GET 请求直接拦截
   - 弹出 toast 提示"游客参观期间，请勿触动控制面板，谢谢！"

3. **组件级 `useGuestGuard` hook**（`hooks/useGuestGuard.ts`）
   - 在每个页面的写操作事件处理函数中注入 guard
   - 点击写按钮（新建、编辑、删除、导出、备份恢复等）即弹出提示
   - 已覆盖全部 15 个系统管理页面

**修复的 Guest 漏洞：**

- Guest 可以恢复数据库 → 修复：`guestReadOnlyMiddleware` 拦截
- Guest 可以数据导出 → 修复：写语义 GET 路径拦截
- Guest 可以操作表结构管理 → 修复：组件级 guard
- Guest 可以操作系统管理大部分功能 → 修复：三层防护全覆盖

### 🛡️ SuperAdmin 自动提升

- 启动时 `ensureSuperAdmin()` 自动将默认 admin 用户提升为 `superadmin` 角色
- SuperAdmin 独占 `/api/platform/*` 平台管理 API
- 前端 `SuperAdminGuard` 组件控制平台管理菜单可见性
- JWT payload 中 `role: "superadmin"`，与普通 `admin` 区分

### 🏷️ 品牌更名

- 登录页面标题："作战平台" → "会战管理"
- 侧边栏品牌名同步更名

### 🔐 登录页安全加固

- 移除默认管理员账号密码提示（`admin/admin123`）
- 防止信息泄露

### 🐛 Bug 修复

- 修复 `superAdminMiddleware` 泄漏到所有 `/api` 路由的问题
- 修复 Guest/Register 流程缺少 `setAuthToken` 导致认证状态不一致
- 修复 Guest 每次访问态势页都弹出教程的问题
- 修复 Share Router 在 `COMBAT_NO_AUTH` 模式下的权限问题

### 📊 测试

- 后端测试：821/821 通过（新增 39 个测试）
- Guest UI 回归：18/18 页面全部 PASS，0 写操作成功
- Admin 页面扫描：21 页面全部 OK

### 相关 Commit

| Commit    | 说明                                                       |
| --------- | ---------------------------------------------------------- |
| `66d443a` | superAdminMiddleware 路由泄漏修复                          |
| `eba3c10` | guest/register 流程 setAuthToken 修复                      |
| `bc1cadc` | guest 教程弹窗修复 + guest 只读中间件                      |
| `75e5de3` | guestReadOnlyMiddleware 初始实现                           |
| `1f96df2` | adminMiddleware/leaderMiddleware guest 放行 GET            |
| `6651986` | guestReadOnlyMiddleware 写语义 GET 拦截 + 前端 req() guard |
| `7ed2b64` | 登录页安全加固 + 品牌更名「会战管理」                      |
| `ffb010c` | useGuestHook 覆盖全部 15 页面                              |

---

## v3.0.0 (2026-06-01) — 共享功能 + SaaS 多租户架构

### 🏗️ SaaS 多租户

- 多租户架构：`SAAS_MODE=1` 启用，不设则单租户模式，向后兼容
- 平台管理：superAdmin 管理租户 CRUD + 暂停/恢复 + 资源统计
- 租户详情：用户列表 + 资源用量 + 配额进度条
- 注册流程：创建团队 / 加入团队（邀请码）
- Guest 免登录体验：自动创建临时用户，1 天 JWT
- 计划配额：free/pro/enterprise 三档（用户数 + 节点数）

### 🔗 共享功能

- 知识库文章、攻关单、信息广场卡片的外部链接分享（加密短链 + 密码 + 有效期）
- 站内用户共享（搜索选择 + 通知推送）
- 分享管理面板（链接管理 + 访问趋势图）
- 公共分享页面 `/s/:token`（无需登录，密码保护）

### 📊 测试

- 后端测试：790/790 通过
- shared 测试：28/28 通过
