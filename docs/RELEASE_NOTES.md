# 版本发布说明

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
