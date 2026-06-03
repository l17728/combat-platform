# 共享功能设计文档

> 版本: v1.0 (已实现) | 日期: 2026-06-03 | 状态: ✅ 已实现 (P0-P3 全部完成)

## 1. 背景与目标

当前系统缺乏跨用户、跨攻关单的共享能力。用户无法：

- 把攻关单分享给非成员查看
- 把知识库文章分享给其他攻关单或外部人员
- 把公告/信息广场内容转发给特定人员

**目标**: 提供统一的共享机制，覆盖攻关单、知识库文章、公告三类实体，支持站内共享和站外链接分享。

---

## 2. 共享场景矩阵

| 场景                  | 共享对象     | 共享给         | 方式                    | 当前状态 |
| --------------------- | ------------ | -------------- | ----------------------- | -------- |
| 攻关单 → 站内用户     | 攻关单详情   | 指定用户/角色  | 站内通知 + 权限临时开放 | ❌       |
| 攻关单 → 外部链接     | 攻关单摘要   | 未登录用户     | 加密短链 + 过期时间     | ❌       |
| 知识库文章 → 攻关单   | 文章内容     | 目标攻关单成员 | 复制/引用到局部知识库   | ❌       |
| 知识库文章 → 外部链接 | 文章内容     | 未登录用户     | 加密短链 + 过期时间     | ❌       |
| 公告 → 站内用户       | 信息广场卡片 | 指定用户/角色  | 站内通知                | ❌       |
| 公告 → 外部链接       | 公告详情     | 未登录用户     | 加密短链 + 过期时间     | ❌       |

---

## 3. 数据模型

### 3.1 共享记录表 `shared_links`

```sql
CREATE TABLE shared_links (
  id TEXT PRIMARY KEY,                -- UUID
  token TEXT NOT NULL UNIQUE,          -- 加密短链 token (URL-safe, 12字符)
  entity_type TEXT NOT NULL,           -- 'ticket' | 'wiki' | 'infoCard'
  entity_id TEXT NOT NULL,             -- 攻关单/文章/公告 ID
  share_type TEXT NOT NULL DEFAULT 'link',  -- 'link'(链接) | 'internal'(站内)
  shared_by TEXT NOT NULL,             -- 分享人 displayName
  password TEXT,                       -- 可选: 访问密码 (bcrypt hash)
  max_views INTEGER,                   -- 可选: 最大查看次数
  current_views INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,                     -- 可选: 过期时间 ISO string
  target_users TEXT,                   -- 站内共享: 目标用户 JSON 数组
  created_at TEXT NOT NULL,
  revoked_at TEXT                      -- 撤销时间
);

CREATE INDEX idx_shared_links_token ON shared_links(token);
CREATE INDEX idx_shared_links_entity ON shared_links(entity_type, entity_id);
```

### 3.2 共享访问日志 `shared_link_views`

```sql
CREATE TABLE shared_link_views (
  id TEXT PRIMARY KEY,
  link_id TEXT NOT NULL REFERENCES shared_links(id),
  viewer_ip TEXT,
  viewer_user TEXT,                    -- 站内用户名 (如有)
  viewed_at TEXT NOT NULL
);
```

---

## 4. API 设计

### 4.1 创建共享链接

```
POST /api/share
Body: {
  entityType: 'ticket' | 'wiki' | 'infoCard',
  entityId: string,
  password?: string,        // 可选访问密码
  expiresIn?: number,       // 过期秒数 (3600=1h, 86400=1d, 604800=7d)
  maxViews?: number,        // 可选最大查看次数
  targetUsers?: string[],   // 站内共享目标用户
}
Response: {
  url: string,              // 完整分享链接
  token: string,            // 短链 token
  expiresAt?: string,
}
```

### 4.2 访问共享内容

```
GET /api/s/:token
Query: ?password=xxx
Response: {
  entityType: string,
  title: string,
  content: string,          // 脱敏后的内容
  sharedBy: string,
  sharedAt: string,
  expiresAt?: string,
}
```

- 攻关单: 返回摘要（标题、状态、描述），**不包含**私密字段（成员列表、授权人等）
- 知识库文章: 返回标题 + Markdown 正文
- 公告: 返回标题 + 内容 + 分类标签

### 4.3 管理共享链接

```
GET /api/share?entityType=xxx&entityId=xxx   -- 列出某实体的所有分享链接
DELETE /api/share/:id                         -- 撤销分享链接
```

### 4.4 文章复制到攻关单

```
POST /api/wiki/:id/copy
Body: {
  targetScopeId: string,    -- 目标攻关单 ID
  title?: string,           // 可选新标题，默认"副本: 原标题"
}
```

---

## 5. 前端交互

### 5.1 分享按钮位置

| 位置                 | 触发方式     |
| -------------------- | ------------ |
| 攻关单详情页标题栏   | 「分享」按钮 |
| 知识库文章右侧操作栏 | 「分享」按钮 |
| 信息广场卡片详情     | 「分享」按钮 |

### 5.2 分享弹窗内容

```
┌─────────────────────────────────────┐
│  分享: [文章标题]                      │
├─────────────────────────────────────┤
│                                     │
│  ○ 生成分享链接                       │
│    有效期: [7天 ▼]  访问密码: [可选 □]  │
│                                     │
│  ○ 分享给站内用户                      │
│    用户: [搜索选择...]                 │
│                                     │
│  ─────────────────────────────────  │
│                                     │
│  复制到攻关单知识库 (仅文章)            │
│  目标: [搜索攻关单...]                │
│                                     │
│  [取消]              [确认分享]        │
└─────────────────────────────────────┘
```

### 5.3 分享链接页面 (`/s/:token`)

独立页面，无需登录：

- 顶部显示"来自 [分享人] 的分享"
- 内容区渲染 Markdown（复用 MarkdownRenderer）
- 底部显示"此链接将于 [日期] 过期"
- 如需密码: 先显示密码输入框

### 5.4 分享管理

- 实体详情页增加「分享记录」下拉面板
- 显示所有分享链接、访问次数、过期时间
- 支持撤销（设置 revoked_at）

---

## 6. 安全设计

### 6.1 权限控制

| 操作         | 权限要求                                                            |
| ------------ | ------------------------------------------------------------------- |
| 创建分享链接 | 实体有读权限（攻关单: 成员/授权人; 文章: 任意可见; 公告: 任意可见） |
| 访问分享链接 | token 有效 + 未过期 + 未撤销 + 密码正确(如有) + 未超查看上限        |
| 撤销分享链接 | 分享创建者 或 admin                                                 |
| 列出分享链接 | 实体有读权限                                                        |

### 6.2 脱敏规则

- **攻关单**: 不暴露成员列表、私密授权人、私密授权组、内部进展日志
- **知识库文章**: 加锁文章不允许生成分享链接
- **密码**: bcrypt hash 存储，访问时 timingSafeEqual 验证

### 6.3 Token 安全

- 使用 `crypto.randomBytes(9).toString('base64url')` 生成 12 字符 URL-safe token
- 不可预测，不可枚举
- 索引加速查询

---

## 7. 技术实现要点

### 7.1 新增文件

```
apps/backend/src/
  share.ts              -- ShareRepo + ensureShareTable
  share-router.ts       -- /api/share + /api/s/:token 路由
apps/frontend-v2/src/
  pages/SharedView.tsx  -- /s/:token 独立页面
  components/ShareModal.tsx  -- 分享弹窗组件
```

### 7.2 路由注册

- `server.ts`: 挂载 `makeShareRouter(adapter)` 到 `/api/share` 和 `/api/s`
- `App.tsx`: 添加 `/s/:token` 公开路由（不需要 AuthProvider）

### 7.3 复用

- 分享页面复用 `MarkdownRenderer` 渲染内容
- 审计日志: 创建/撤销分享时写入 `audit_log` (action: `share.create` / `share.revoke`)
- 攻关单脱敏: 复用 `private-tickets.ts` 中的字段白名单逻辑

---

## 8. 优先级与分期

| 期  | 范围                        | 复杂度 | 预估工时 |
| --- | --------------------------- | ------ | -------- |
| P0  | 知识库文章 → 外部链接分享   | 低     | 4h       |
| P0  | 知识库文章 → 复制到攻关单   | 低     | 2h       |
| P1  | 攻关单 → 外部链接分享(脱敏) | 中     | 6h       |
| P1  | 公告 → 外部链接分享         | 低     | 3h       |
| P2  | 站内用户共享(通知)          | 高     | 8h       |
| P2  | 分享管理面板                | 中     | 4h       |
| P3  | 分享统计(访问趋势图)        | 中     | 4h       |

**建议先做 P0**: 知识库文章的外部链接分享和文章复制，覆盖最高频场景，实现简单。

---

## 9. 示例数据流

### 知识库文章分享流程

```
用户点击「分享」
  → ShareModal 弹出，选择"生成链接"，有效期 7 天
  → POST /api/share { entityType: 'wiki', entityId: 'xxx', expiresIn: 604800 }
  → 后端:
      1. 验证用户有权限分享此文章
      2. 检查文章非加锁状态
      3. 生成 token, 写入 shared_links
      4. 写审计日志
  → 返回 { url: 'http://xxx:3001/s/AbCdEfGh1234' }
  → 前端: 显示链接 + 复制按钮

外部用户访问 /s/AbCdEfGh1234
  → GET /api/s/AbCdEfGh1234
  → 后端:
      1. 查 shared_links by token
      2. 检查未过期/未撤销/未超限
      3. 查 wiki_articles by entity_id
      4. 写 shared_link_views 访问日志
      5. current_views++
  → 返回 { title, content, sharedBy, ... }
  → SharedView.tsx 渲染 Markdown
```
