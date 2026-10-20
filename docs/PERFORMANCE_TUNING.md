# Performance Tuning Handbook

性能调优手册。v2.2 P1 落地后的实测要点 + 何时该用什么 API。

## queryNodesByProperty vs queryNodes

### 何时用 queryNodesByProperty(下推)

| 场景                                            | 建议                                                      |
| ----------------------------------------------- | --------------------------------------------------------- |
| 单键等值过滤(`{key: "value"}`)且 value 是字符串 | ✅ 用 queryNodesByProperty                                |
| 多键过滤(`{k1: v1, k2: v2}`)                    | 仍用 queryNodes(框架不支持多键下推,会全表扫)              |
| 范围/区间过滤(>, <, IN, LIKE)                   | 仍用 queryNodes(filter 函数自定义即可)                    |
| value 为数字 / 布尔且字段以 JSON 数字存储       | 用 queryNodes(json_extract 返回 number,与字符串 ? 不相等) |
| 不需要过滤(`queryNodes(nt)`)                    | 直接 queryNodes,无需改                                    |

### 已加表达式索引的热点 key (SQLite)

`db.ts` 中 `SQLITE_SCHEMA_DDL` 提供以下表达式索引,自动启用:

```sql
idx_nodes_prop_status       -- nodeType + 状态
idx_nodes_prop_pb           -- nodeType + 问题单号
idx_nodes_prop_creator      -- nodeType + 创建人
idx_nodes_prop_customer     -- nodeType + 客户名称
idx_nodes_prop_email        -- nodeType + 邮箱
idx_nodes_prop_group        -- nodeType + 组名
idx_nodes_prop_name         -- nodeType + 姓名
idx_nodes_prop_handler      -- nodeType + 当前处理人
idx_nodes_prop_contributor  -- nodeType + 贡献人
```

需要新增热点索引时,直接在 DDL 后追加 `CREATE INDEX IF NOT EXISTS ... ON nodes(nodeType, json_extract(properties, '$.<key>'))`,旧库自动升级(IF NOT EXISTS 幂等)。

### Postgres 路径

PG 走 `properties->>'<key>' = ?` + 全局 `idx_nodes_properties_gin` GIN on JSONB,无需为单键单独加索引(GIN 通用)。

### 验证索引在用(SQLite)

```bash
sqlite3 /opt/combat-v2/data/combat.sqlite "EXPLAIN QUERY PLAN \
  SELECT * FROM nodes WHERE nodeType='attackTicket' \
  AND json_extract(properties, '\$.状态') = '进行中'"
# 期望输出包含 USING INDEX idx_nodes_prop_status
```

未走索引时(EXPLAIN 显示 SCAN nodes)排查:

1. nodeType 必须放在 WHERE 第一项(索引顺序敏感)
2. value 类型必须是字符串(数字字段无法走 idx)
3. 老库可能需 `ANALYZE nodes` 让 SQLite 重新统计

## conflicts 增量算法

### 触发链路

```
attackTicket POST/PUT/transition
  → triggerPostSaveJobs(repo, registry, ticketId)
  → scheduleConflictsSync(repo, ticketId)   # 30s 防抖
  → runDebouncedConflicts()
      - ids.length ≤ 50 → 每个 id 跑 syncConflictsForOne(增量)
      - ids.length > 50 → 兜底全量 syncConflicts
```

### 何时手动跑全量

- KG 重建 (`POST /api/kg/rebuild`)
- 后台定时任务 (`jobs.ts:tick`,每小时一次)
- 合并人员 (`merge.ts` 末尾)

### 调试

backend.log 关键事件:

- `post_save.conflicts.debounced_incremental ticketCount=N` — 增量路径
- `post_save.conflicts.debounced_full ticketCount=N` — 兜底全量(N=0 表示无 ticketId 信息或 N>50)
- `post_save.conflicts.fail error=...` — 失败

## appendProgress 原子 seqNo

新 SQL form:`INSERT ... SELECT COALESCE(MAX(seqNo),0)+1 ... FROM progress_log WHERE ownerId=?`。
SQLite + Postgres 同句兼容。事务内 SELECT 可读到本事务可见上下文,正确。

PG 部署时仍建议加 `UNIQUE INDEX (ownerId, seqNo)` 作为最后防线(双副本写并发到不同 connection)。SQLite 单写者天然无此需求。

## /api/metrics 解读

无 auth Prometheus scrape 端点。可直接 `curl http://localhost:3001/api/metrics`。

### 关键指标

| 指标                                              | 解读                                        |
| ------------------------------------------------- | ------------------------------------------- |
| `combat_http_requests_total{method,route,status}` | 按路由/状态分类的请求数,500 段告警          |
| `combat_http_request_duration_ms_bucket`          | histogram,推 p50/p95/p99 latency            |
| `combat_http_in_flight`                           | 当前并发请求数,持续 > 50 表示后端过载       |
| `combat_db_queries_total{kind}`                   | DB 查询数,SELECT 暴涨表示新热点接口未加缓存 |
| `combat_nodejs_eventloop_lag_seconds`             | event loop 延迟,> 0.1s 表示同步阻塞         |
| `combat_process_resident_memory_bytes`            | 进程驻留内存,持续增长 = 内存泄漏            |

### Grafana 推荐 PromQL

```promql
# p99 latency by route
histogram_quantile(0.99, sum(rate(combat_http_request_duration_ms_bucket[5m])) by (route, le))

# 错误率
sum(rate(combat_http_requests_total{status=~"5.."}[5m])) / sum(rate(combat_http_requests_total[5m]))

# 当前并发
combat_http_in_flight
```

### 阻塞 Prometheus 抓取

如需暂时屏蔽 metrics 端点(测试环境):反代加 `location = /api/metrics { return 403; }`。

## recommend / proposer 算法优化

- `recommendHelpers`:N+1 已消除(1 次 queryEdges + 内存 join),5k contribution 量级亚秒响应
- `HeuristicRelationProposer`:Δlen > threshold 预筛跳过 leven,1k persons 量级从 50万次 leven 降到 ~10万次

后续优化方向(P2):

- Hermes fallback 全文搜索:迁 PG 后改 `to_tsvector + GIN`,ms 级
- proposer:加 LSH (MinHash / n-gram blocking) 进一步降到 O(N)
- dashboard summary:加 60s in-memory TTL cache(已合 5 次扫为 1 次,缓存边际下降)

## 基线 (v2.2 P1 实施后)

- 463 backend tests → 478 全绿(+5 queryNodesByProperty +5 conflicts-incremental +4 metrics +health/dashboard 既有)
- baseline 测试时长无显著退化(86s → 76s)
- 9 个 SQLite 表达式索引共占用约 < 100 KB / 10k 节点

## PM2 Cluster 使用说明 (v2.3.1 harden)

仓库根 `ecosystem.config.cjs` 是 PM2 的进程编排清单。默认 `instances: "1" / fork` 模式,
和现在 systemd 单实例完全等价 — 可直接接入 SQLite 生产部署作为对等替代品(零行为差异)。

### 何时切到 cluster

**仅在切换到 Postgres adapter 后**才允许把 `COMBAT_PM2_INSTANCES` 设为 `max` (或 ≥2)。
better-sqlite3 是单进程同步引擎,SQLite WAL 也只允许单写者;cluster 模式下多个 worker
对同一 `combat.sqlite` 文件并发写会触发文件锁竞争 → 行为未定义(最严重的情况:WAL 撕裂、
读端拿到不一致快照)。Postgres 走 MVCC + 行锁,天然支持多进程并发。

### 启动方式

| 场景                        | 命令                                                                            |
| --------------------------- | ------------------------------------------------------------------------------- |
| 单实例 / SQLite             | `pm2 start ecosystem.config.cjs`                                                |
| 多实例 / Postgres           | `COMBAT_PM2_INSTANCES=max DB_URL=postgres://... pm2 start ecosystem.config.cjs` |
| 前台 (CI / systemd-wrapped) | `pm2 start ecosystem.config.cjs --no-daemon`                                    |
| 滚动重载 (零中断)           | `pm2 reload combat-v2`                                                          |

### 与 systemd 的取舍

| 维度              | systemd (现状)                           | PM2 cluster                    |
| ----------------- | ---------------------------------------- | ------------------------------ |
| 单实例 SQLite     | ✓ 简单                                   | ✓ 行为等价,多了一层进程管理    |
| 多实例 (Postgres) | ✗ 需要外层 nginx 做反代 + 端口轮转       | ✓ 内建负载均衡                 |
| 零中断重载        | ✗ restart 会中断连接                     | ✓ `pm2 reload` 滚动            |
| 内存防御          | ✗ 需另写 watchdog                        | ✓ `max_memory_restart: 1G`     |
| 日志路径          | `/opt/combat-v2/backend.log` (logrotate) | 同路径 (`out_file/error_file`) |
| 开机自启          | systemctl enable                         | `pm2 startup` + `pm2 save`     |
| 监控指标          | journalctl + Prometheus                  | + pm2 plus (可选)              |

### 当前部署模式

生产 124.156.193.122 仍是 systemd + SQLite + fork(单进程)。`ecosystem.config.cjs` 已落地
但**未启用**,留作 Postgres 切换时的零成本横向扩展开关。

### 验证清单

本地验证步骤(任意 NODE_ENV=production 平台):

```bash
npm run build --workspace=@combat/shared
npm run build --workspace=@combat/backend
JWT_SECRET=$(openssl rand -hex 32) \
  COMBAT_PM2_LOG_DIR=./logs \
  pm2 start ecosystem.config.cjs --no-daemon
# 另一窗口
curl -sf http://localhost:3001/api/health && echo "OK"
pm2 list && pm2 logs combat-v2 --lines 5
pm2 delete combat-v2 && pm2 kill
```
