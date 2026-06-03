# Release Notes

## v3.0.0 (2026-06-03)

### 共享功能 (Sharing P0-P3)

本版新增统一的跨用户、跨攻关单共享机制，覆盖知识库文章、攻关单、公告三类实体，支持站外链接分享和站内用户共享。

- **外部链接分享**: 知识库文章、攻关单（脱敏）、信息广场卡片均可生成加密短链（12 字符 URL-safe token），支持设置访问密码、有效期、最大查看次数
- **站内用户共享**: 通过用户搜索选择器将内容推送给指定用户，接收人收到通知中心消息提醒
- **分享管理面板**: ShareModal 双 Tab（创建 + 管理），管理 Tab 展示所有分享链接及访问统计，支持一键撤销
- **访问趋势图**: 分享链接最近 30 天每日访问量柱状图（`GET /share/stats`）
- **文章复制到攻关单**: `POST /wiki/:id/copy` 将知识库文章一键复制到目标攻关单的局部知识库
- **公共分享页面**: `/s/:token` 独立页面，无需登录即可查看分享内容；密码保护文章弹出密码输入框（bcrypt + timingSafeEqual）
- **安全设计**: 加锁文章禁止分享；攻关单分享脱敏（不暴露成员列表、私密授权、进展日志）；token 不可预测不可枚举
- **审计日志**: 分享创建/撤销自动写入 audit_log

### SaaS 多租户 (Phase 0-4)

本版实现完整的 SaaS 多租户架构，通过 `SAAS_MODE=1` 环境变量启用，不设则走原单租户逻辑，向后兼容。

- **多租户核心**: `tenants` 表 + `tenantMiddleware` + JWT `tenantId` 字段，所有业务查询自动按租户隔离
- **平台管理**: `PlatformAdmin.tsx` 租户列表页（创建/编辑/暂停/恢复/统计），superAdmin 角色守卫
- **租户详情**: `TenantDetail.tsx` 展示用户列表、资源用量（用户/节点/边/知识库/审计计数）、配额进度条、租户设置
- **注册流程改造**: LoginPage 双 Tab（登录 + 注册），注册支持「创建团队」和「加入团队」（邀请码）
- **Guest 免登录体验**: `POST /platform/guest-access` 自动创建 guest 用户（1 天 JWT），`ensureGuestTenant` 预创建 guest 租户
- **Guest 数据清理**: 24 小时 cron 自动删除 7 天前的 guest 数据（`cleanGuestData`）
- **计划配额**: `PLAN_QUOTAS` 定义 free/pro/enterprise 三档（用户数 + 节点数），`quotaMiddleware` 在用户创建时检查
- **9 个平台 API**: 租户 CRUD + 暂停/恢复 + 用户列表 + 资源用量 + 设置更新 + guest 访问

### 新增页面与组件

| 页面/组件     | 路由                    | 说明                                          |
| ------------- | ----------------------- | --------------------------------------------- |
| ShareModal    | —                       | 分享弹窗（创建链接/用户共享 + 管理链接/统计） |
| SharedView    | `/s/:token`             | 公共分享页面（无需登录）                      |
| PlatformAdmin | `/platform`             | 租户管理（superAdmin）                        |
| TenantDetail  | `/platform/tenants/:id` | 租户详情（superAdmin）                        |
| LoginPage     | `/login`                | 登录/注册双 Tab + 免登录体验                  |

### 后端新增模块

| 文件                   | 说明                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------- |
| `share.ts`             | ShareRepo + shared_links/shared_link_views DDL                                        |
| `share-router.ts`      | 6 端点：create/access/list/revoke/copy/stats + 通知推送                               |
| `tenant-middleware.ts` | TenantRepo, ensureTenantsTable, superAdminMiddleware, quotaMiddleware, cleanGuestData |
| `platform-router.ts`   | 9 端点：租户 CRUD + 暂停/恢复 + 用户 + 用量 + 设置 + guest                            |

### 修复

- Wiki 删除加锁文章需密码验证（timingSafeEqual 防时序攻击）
- 分享链接 revoke 后不可再访问

---

## v2.9.0 (2026-06-02)

### 知识库 (Wiki) 大版本更新

- **点赞系统**: 文章可点赞/取消点赞，按点赞数排序（加锁 → 点赞 → 普通 三级排序）
- **加锁/密码保护**: 文章可加锁并设置密码，删除加锁文章需输入密码（timingSafeEqual 防时序攻击）
- **编辑权限**: 加锁文章仅创建者或管理员可编辑
- **删除权限**: 仅创建者或管理员可删除；删除后自动聚焦相邻文章
- **分 tier 拖拽**: 拖拽排序仅在同级别（加锁/点赞/普通）内生效
- **审计日志**: 创建/编辑/删除/点赞操作自动写入 audit_log 表
- **折叠模式**: 点击左箭头折叠目录为彩色圆圈首字（类似头像），点击圆圈选中文章，右箭头展开

### MarkdownRenderer 全新渲染引擎

- **Mermaid 图**: ` ```mermaid ` 代码块自动渲染为 SVG 流程图/时序图等
- **YouTube 视频**: YouTube 链接渲染为缩略图+播放按钮（大陆不可直接 iframe 嵌入）
- **Bilibili 嵌入**: `<iframe src="player.bilibili.com/...">` 渲染为响应式播放器，`bilibili.com/video/BVxxx` 自动转换为 embed URL
- **HTML video**: `<video controls><source src="..." type="video/mp4"></video>` 直链视频内嵌播放
- **安全**: rehype-raw + rehype-sanitize 白名单，仅允许 video/source/iframe 标签，iframe 域名限制 YouTube/Bilibili

### 修复

- DashboardScreen 最近活跃 undefined → 后端返回扁平结构适配
- 文档上传 HTTP 500 → FormData 不再被覆盖为 application/json
- Wiki 列表布局: 放弃 List.Item actions 改用 flex 布局，防止标题被挤压空白

### 边类型重命名 (v2.8.0)

- REF → 分配, CONFLICTS_WITH → 冲突, ANCHORED_TO → 关联, ESCALATED_TO → 上报, RELATES_TO → 处理, OVERLAPS_WITH → 重叠
- 影响 ~40 个文件 + 生产数据库 1,187 条边

---

## v2.8.0 (2026-06-01)

- 知识图谱可视化优化: 边按类型着色 + 图例 + hover tooltip + 节点类型筛选
- 边类型重命名 (6 种中文类型)
- Hermes 文字驱动 UI 操作 + 写工具启用
- Weink AI 四级 fallback

## v2.7.0 (2026-05-30)

- 知识图谱冲突检测与重叠关系
- 攻关单详情页增强

## v2.6.0 (2026-05-28)

- HermesChat AI 助手集成
- 知识库基础功能

## v2.5.0 (2026-05-25)

- 仪表盘大屏
- 文档上传管理

## v2.4.1 (2026-05-22)

- 权限系统优化
- Bug 修复
