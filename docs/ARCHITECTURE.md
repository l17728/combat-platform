# Architecture Notes — Resilience Bucket

> 本文记录架构层弹性设计 (resilience) 的关键决策与运行时形态。
> 新增章节请追加在末尾,不要重排已有章节(便于跨版本 diff)。

## 1. KG 派生 outbox + 后台 worker

### 1.1 背景

历史实现:节点保存后用 `setImmediate(syncToKG)` fire-and-forget 触发后台派生
(escalation 扫描 / reminders 扫描 / 单 ticket conflicts 增量),代码见 `routes.ts`
旧版 `triggerPostSaveJobs`。

弊端:

- 进程死掉 → 队列在内存里,任务全丢
- 重启没有补偿机制(只能等下次保存 / 下次 jobs.tick / 手动重建)
- 失败仅写日志,无重试

### 1.2 新设计

引入 `kg_outbox` 表(SQLite + Postgres 双方言 DDL 见 `kg-outbox.ts:ensureKgOutboxTable`)
作为 durable queue:

```
CREATE TABLE kg_outbox (
  id           TEXT PRIMARY KEY,
  eventType    TEXT NOT NULL,    -- attackTicket.saved / .escalation / .reminders
  payload      TEXT/JSONB,       -- { ticketId? }
  status       TEXT,             -- pending / done / failed
  retries      INTEGER,
  last_error   TEXT,
  created_at   TEXT,
  next_run_at  TEXT,             -- 指数退避后下次可执行时间
  processed_at TEXT
);
```

路由层 (`routes.ts`) 写完节点后调 `enqueueKgOutbox` —— 投递 3 条事件:

1. `attackTicket.saved` (payload.ticketId) → worker 调 `syncConflictsForOne`
2. `attackTicket.escalation` → worker 调 `scanEscalation`
3. `attackTicket.reminders` → worker 调 `scanAndCreateReminders`

后台 `KgOutboxWorker` (默认 1s 轮询,可 `KG_OUTBOX_POLL_MS` 调) 拉一批 pending
且 `next_run_at ≤ now` 的行,逐个处理:

- 成功 → status=done, processed_at=now
- 失败 → retries+1, 指数退避 `next_run_at = now + 2^retries * 1s`
- 5 次后置 failed

启动期 `app.ts:createApp` 里 `ensureKgOutboxTable` + 起 worker(NODE_ENV=test 不起,
避免干扰显式调 scan endpoint 的测试)。

### 1.3 兜底与运维

- CLI `kg:outbox:status` 看 pending/done/failed 计数
- CLI `kg:outbox:list --status failed` 列具体行
- CLI `kg:outbox:replay` 把 failed 全部重置为 pending 并立即处理一轮
- CLI `kg:outbox:process` 立即处理一轮 pending(无需等 worker)
- HTTP `GET /api/kg-outbox/status` / `GET /api/kg-outbox` / `POST /api/kg-outbox/replay`

### 1.4 迁移与兼容

老 30s 防抖逻辑已删除,worker 自身轮询节流;短时间多次保存会写多条 outbox,但 conflicts
事件用增量算法 (`syncConflictsForOne`),代价线性。

测试侧 `helpers.ts:makeTestApp` 默认 adapter 存在 → 表自动创建。`makeRealSchemaTestApp`
没传 adapter → outbox 路径自动降级为 noop(与历史行为一致)。

### 1.5 验证手段

- `apps/backend/test/kg-outbox.e2e.test.ts` 6 个 case 覆盖 enqueue / process / retry /
  failed / replay / HTTP route
