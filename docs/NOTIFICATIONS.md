# 通知中心 (Inbox Notifications) — 系统文档

> v2.3.4 引入。覆盖 schema / API / SSE / 触发源 / 邮件 digest 选项。

通知中心是一个**按用户隔离的私人收件箱**,集中展示与当前用户相关的系统事件。与既有「跟催提醒」(reminder 决策队列) 是两个独立系统:跟催提醒是管理员操作台,逐条人工决定发不发邮件;通知中心是每位用户都有的轻量级通知聚合,不需要决策,只需阅读或忽略。

## 1. 数据模型

```sql
CREATE TABLE inbox_notifications (
  id               TEXT PRIMARY KEY,        -- UUID
  user_id          TEXT NOT NULL,           -- 收件人 username
  kind             TEXT NOT NULL,           -- 见 §2
  title            TEXT NOT NULL,           -- 一行摘要
  body             TEXT,                    -- 详情正文 (可选)
  link             TEXT,                    -- 点击后跳转的相对路径
  source_entity_id TEXT,                    -- 触发实体 id (可选,用于反查)
  read_at          TEXT,                    -- ISO 时间;NULL = 未读
  created_at       TEXT NOT NULL            -- ISO 时间
);

CREATE INDEX idx_inbox_user_unread
  ON inbox_notifications(user_id, read_at, created_at DESC);
```

设计要点:

- **不入审计日志**:辅助通道,真实业务事件本身在 audit_log 已记录。
- **无软删除**:用户可以「全部已读」但不能删除。运维清理用 SQL TTL (如 30 天前 read_at 不为空可清理)。
- **不查 nodes/edges**:完全独立,可与主库异构存储。

## 2. 通知类型 (kind)

| kind           | 中文     | 触发条件                                     | 收件人                 |
| -------------- | -------- | -------------------------------------------- | ---------------------- |
| `escalation`   | 升级     | attackTicket 超过事件级别 SLA                | 当前处理人 + 创建人    |
| `reminder`     | 跟催     | 规则引擎扫描出待跟催的问题单/FE Deadline/CCB | 提醒目标人(收件人姓名) |
| `mention`      | 提及     | 进展记录中 @ 某人 (v2.3.5+)                  | 被提及用户             |
| `help_request` | 求助     | 求助邮件失败 / 对方回复了求助                | 求助发起人             |
| `bug_update`   | 问题更新 | bug_reports 状态变更                         | 提报人                 |
| `system`       | 系统     | 平台公告 / 升级提醒 (admin 手动创建)         | 全员或指定用户         |

颜色 (在 `apps/frontend-v2/src/constants.ts`):

```ts
NOTIFICATION_KIND_COLOR = {
  escalation: "red",
  reminder: "orange",
  mention: "blue",
  help_request: "cyan",
  bug_update: "purple",
  system: "default",
};
```

## 3. HTTP API

所有端点位于 `/api/notifications`,鉴权走 `authMiddleware` (JWT)。`COMBAT_NO_AUTH=1` 时默认用户 = `admin`。

| 端点                              | 方法      | 说明                                                                                                      |
| --------------------------------- | --------- | --------------------------------------------------------------------------------------------------------- |
| `/api/notifications`              | GET       | 列出当前用户最近通知。Query: `unread=true` / `limit=N` (默认 50, 最大 200)。响应 `{ items, unreadCount }` |
| `/api/notifications/unread-count` | GET       | 仅返回未读数 `{ unreadCount }`,适合高频轮询                                                               |
| `/api/notifications/stream`       | GET (SSE) | Server-Sent Events 实时推送 (见 §4)                                                                       |
| `/api/notifications/:id/read`     | POST      | 标记单条为已读;响应更新后的通知;非己 owner → 404                                                          |
| `/api/notifications/read-all`     | POST      | 全部标已读;响应 `{ updated: N }`                                                                          |
| `/api/notifications`              | POST      | 创建一条 (**仅 admin**)。body: `{ userId, kind, title, body?, link?, sourceEntityId? }`                   |

## 4. SSE 实时推送

```
GET /api/notifications/stream
Authorization: Bearer <JWT>
Content-Type: text/event-stream
```

事件流:

```
event: ready
data: {"ok":true}

event: notification
data: {"id":"...", "userId":"alice", "kind":"escalation", ...}

: ping 1717000000000    // 25s keepalive
```

- 服务端在 `notifications.ts` 用 in-process pub/sub (`subscribeNotifications`) fanout;每条 `create()` 立即广播给所有订阅者,订阅者按 `userId` 过滤。
- 当前**单进程内有效**;集群部署需替换为 Redis pub/sub (在 `publish()` 后追加 `redis.publish(channel, JSON.stringify(n))`,在 `subscribeNotifications()` 内并行订阅 Redis 通道)。
- 客户端 `NotificationBell.tsx` 优先用 SSE;`onerror` 自动回落到 30s `setInterval` 轮询 `/api/notifications`,并保留一个 90s 兜底轮询防丢包。

## 5. 触发源接入

通知是**事件驱动**的:业务侧不直接 import API,而是把可选 `NotificationsRepo` 注入到现有 router/scan 函数。

### Escalation (`apps/backend/src/escalation.ts`)

```ts
scanEscalation(repo, notifications);
```

SLA 超时 → ESCALATE audit + ESCALATED_TO edge + 给 owner/creator 推 `escalation`。

### Reminders (`apps/backend/src/reminders.ts`)

```ts
scanAndCreateReminders(repo, registry, notifications);
```

规则引擎扫描出的每条 reminder → 同步给 `recipientName` 推 `reminder` 通知。

### Help Request (`apps/backend/src/help-request.ts`)

```ts
makeHelpRequestRouter(adapter, repo, mailSender, baseUrl?, notifications?)
```

- POST `/help-requests` 时若邮件发送失败 → 给求助人推 `help_request` (标题: "求助邮件发送失败")
- POST `/help/feedback/:token` 收到反馈 → 给求助人推 `help_request` (标题: "求助有回复了")

### Bug Report (`apps/backend/src/bug-report.ts`)

```ts
makeBugReportRouter(adapter, notifications?)
```

PATCH 时若 `status` 变化且 `reporter` 非空 → 给提报人推 `bug_update`。

### 手动 / 系统公告

admin 调用 `POST /api/notifications` 直接创建,适合维护公告 / 测试 / 把 v2.3.4 之前没接通知的事件回灌。

### 失败兜底

所有触发点都通过 `createNotificationSafe(repo, input)` 调用,内部 try/catch 仅 `log.warn` 不抛 — 通知是辅助渠道,绝不让主流程挂掉。

## 6. CLI

```
npm run cli -- notifications:list [--unread] [--limit N]
npm run cli -- notifications:read <id>
npm run cli -- notifications:read-all
npm run cli -- notifications:create --user <u> --kind <k> --title <t> [--body <b>] [--link <url>]
```

CLI 走 `COMBAT_API` (默认 `http://localhost:3001`) + JWT (`COMBAT_TOKEN` 或 `auth:login` 拿到的 token)。

## 7. 邮件 Digest (可选,未实现)

设想:对低优先级 kind (system / reminder),允许用户配置「每天 09:00 汇总成一封邮件」而不是实时推。预留扩展点:

- `app_settings` 增 key `notifications.digest.<userId>` = JSON `{ enabled, kinds, time }`
- 新增 `digestNotifications()` 定时任务 (每天 09:00 跑) — 拉所有 `digest.enabled=true` 用户的过去 24h 未读 → 渲染 HTML → 走 `MailSender` 发送
- 发送成功后将这批通知打 `digestSentAt` 标签 (不删,不影响列表)

当前版本**不实现**,通知一律实时(铃铛 + 站内列表)。

## 8. 前端组件

- `components/NotificationBell.tsx` — 顶栏铃铛 + Badge + Dropdown(最近 10 条) + SSE 订阅
- `pages/NotificationsPage.tsx` — `/notifications` 全列表 + 筛选 + 全部标已读
- `components/BreadcrumbBar.tsx` — v2.3.4 一并上线的配置驱动面包屑

## 9. 与既有 `notifications` 表的关系

⚠️ 注意:仓库里**已有**一张叫 `notifications` 的表 (`db.ts` 内),实际存的是 **reminder 决策队列** (kind/ticket_id/recipient_person_id/status),由 `SqliteRepository.createReminder()` 写入,被 `/api/reminders` 操作。

为避免语义混淆,v2.3.4 新表命名为 `inbox_notifications`,**两表完全独立**:

- `notifications` (旧表) = admin 的提醒决策台 → "我要不要给 X 发提醒邮件?"
- `inbox_notifications` (新表) = 每个用户的私人收件箱 → "什么事跟我有关?"

一条 reminder 生成时会**同时**给收件人推 `inbox_notifications` (kind=`reminder`),两边数据互不依赖。
