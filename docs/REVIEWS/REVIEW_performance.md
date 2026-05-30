# 性能 / 并发 / HA 评审 — by Netflix 级 SRE
日期: 2026-05-30 | 分支: master @ 6783b0f

## 总评分: 4.0 / 10

单进程 better-sqlite3 同步写 + 全表 JSON 扫描的"内存里跑业务"型架构;**对 < 5 千节点的内部小工具是恰到好处的工程权衡**(简单、可演进、零运维),但**不具备任何水平扩展能力,且热点接口在 1 万节点量级就会肉眼可见地降级**。当前没有任何 health check、metrics、对外熔断;韧性主要靠 systemd `Restart=always` 兜底。是"能用 5 年的 v1",不是"撑住公司业务的 v3"。

## 当前承载预期(估算,假设节点平均 properties JSON ≈ 1 KB)

| 维度 | SQLite (现状) | PG (规划) |
|------|--------------|-----------|
| 节点数 ceiling(p99 接口 < 1s) | **~5 000** | **~500 000** |
| 节点数 ceiling(可勉强用) | ~30 000 | ~5 000 000 |
| 并发用户(写)上限 | **1**(better-sqlite3 同步 → 全局串行) | 100+ |
| 并发用户(读)上限 | 数十(WAL 多读单写) | 数百 |
| API p99 估计(< 1 千节点) | 20-80 ms | 同级 |
| API p99 估计(~ 1 万节点) | 300-1500 ms(全表扫 + JSON.parse) | 30-100 ms |
| 单写事务峰值 QPS | < 50(同步阻塞 + audit 2 写) | ~ 1 k |

> **核心瓶颈不是 SQLite,是 `queryNodes` 全表扫 + 应用层过滤 + JSON.parse fanout**。同款代码搬到 PG 上不上 JSONB GIN 索引也救不了。

## 维度评分

| 维度 | 分 | 实证 |
|------|----|------|
| 算法复杂度 | 3/10 | `queryNodes` 应用层过滤 O(N);`conflicts.syncConflicts` 同 owner C(k,2) 双向写边 O(k²);`proposer.HeuristicRelationProposer.propose` 同 nodeType 两两 levenshtein O(N²·L²);`hermes.fallback-search` 跨 nodeType 全扫 + `substring` 计数;multiple N+1 已部分修(`conflicts.ts:82`, `escalation.ts:33-34`, `responsibility.ts:78-81`)— 还存在的:`recommend.ts:43-53` `queryNodes("contribution")` 全扫 + 每条调 `queryEdges`,`routes.ts:174` `attackTicket` 全扫找 `攻关单号` |
| DB 性能 | 4/10 | better-sqlite3 同步;**有 WAL** 但没有事务批处理;**有索引但被绕过** — `repository.queryNodes` 即便有 `idx_nodes_type` 也总是 `SELECT *` 后 JSON.parse 全部行;**search_text 列被写入了但没建索引、没人查它**(`repository.ts:60-62, 82-85` 写,无 SELECT);properties 是 TEXT JSON 而不是 SQLite JSON1 函数索引,业务字段过滤永远走应用层 |
| 并发安全 | 5/10 | better-sqlite3 单进程同步天然串行,**单机下事务边界是对的**(create/update/delete/merge 都包了 `db.transaction(...)()`);但 `appendProgress` 的 seqNo 用 `SELECT MAX(seqNo)+1`(`repository.ts:146-149`)在事务里 — better-sqlite3 同步下安全,**一旦换 PG/async 立刻是经典竞态**;`triggerPostSaveJobs` 用 `setImmediate` fire-and-forget 跑 3 个 scan(`routes.ts:21-26`),scan 内部调 `repo.deleteEdges + repo.createEdge` 重建衍生边 — 多个请求并发触发会互相覆盖中间态,目前靠 SQLite 全局串行掩盖问题 |
| 可扩展性 | 2/10 | **单进程 SQLite 是硬天花板** — 不能多实例(WAL 单写者);无 session store(JWT stateless ✓);Hermes opencode runner 是单例 `clientP`,无连接池;后台扫描 + 备份 + jobs 在同一进程,无隔离;前端静态资源由后端 Express 服务,无 CDN/反代;**部署在单台机器单端口 3001**,垂直扩 = 升级 VM,水平扩 = 0 |
| 缓存策略 | 3/10 | `useSettings.ts` 实测**没有缓存**(每个 hook 实例 useEffect 调一次 `api.listSettings()`),13 个页面都在挂载时拉一次 settings — 一次页面切换发起 N 个相同请求;后端无任何应用层 cache(Schema 读盘每次 reload?需查 registry);`ui-cache` 是用户 pinning,不是性能 cache;hermes intent 答案没缓存(每问每答全表扫一次);**强项是 better-sqlite3 自己的 page cache 让二次同样 query 极快**,弥补了应用层无缓存 |
| 韧性 | 6/10 | **强项**:`systemd Restart=always`(`combat-v2-direct.service:13`),`asyncHandler` 把 async throw 转 500(`logger.ts:52-59`),Hermes agent 失败静默回退规则引擎(`hermes.ts:326-334`,有 timeoutMs 兜底),备份 restore_pending 两阶段(`backup.ts:121-127`);**弱项**:**无 healthcheck endpoint**(grep `/health` 0 命中),systemd 不知道进程"卡死"只能看进程在不在;**无熔断/限流**(express 裸跑,没 rate-limit / circuit-breaker);body `limit: '20mb'`(`app.ts:52`)无背压;Hermes 默认超时 180 s — 用户体感太长,且没有取消机制;后台 setInterval 3 个,失败只 log 不告警,堆积错误无人知 |
| 可观测性 | 6/10 | **94 个 log 事件 + 104 处 `log.{info,warn,error}` 调用**(grep 验证)写得很有纪律性,每个 HTTP 请求都 `http.request {method,path,status,ms}`(`logger.ts:35-48`)— 等于免费有了访问日志和延迟分布;`audit_log` 表 21 类业务事件(CREATE/UPDATE/...)在 SQLite 里,可回溯;**但**:没有 metrics(/metrics 端点不存在),没有 traces,没有 Prometheus/Grafana,p99 算不出来只能 grep;`backend.log` append-only 单文件无 rotation,**长期跑会撑满磁盘**;无错误率告警,500 错只是 log line;structured log 是 KV 文本而不是 JSON,Loki/ES 解析要写 parser |
| 部署模式 | 5/10 | **强项**:systemd 单服务清晰,`Restart=always + RestartSec=5`,单端口 3001 简化反代,直连 SSH 部署快;`COMBAT_DB_PATH=/opt/combat-v2/data/combat.sqlite` 在 deploy 路径外(避免 `rm -rf` 误伤数据,这是一个非常正确的工程决定);`applyRestorePending` 重启时自动套用备份恢复;**弱项**:**没有容器化**(npm 不可重复构建,Node 版本绑死在路径里:`/root/.nvm/versions/node/v22.22.3/bin/npx tsx`);**`tsx` 直接跑源码,没有 build step** — 启动慢、内存高、不适合 prod;无蓝绿/滚动,`rm -rf` + 上传新包 = 必有 downtime;无备份的异地复制;无 K8s/HA |

## 已知性能热点(实证 + 复杂度)

### 1. `repository.queryNodes` — 应用层过滤(`repository.ts:91-97`)
```ts
const rows = this.db.prepare(`SELECT * FROM nodes WHERE nodeType=? ORDER BY created_at DESC`).all(nodeType);
let out = rows.map(r => ({ ..., properties: JSON.parse(r.properties), ... }));
if (filter) out = out.filter(n => Object.entries(filter).every(([k, v]) => n.properties[k] === v));
```
- O(N) 全扫 nodeType 分区 + N 次 `JSON.parse` + 应用层 filter
- **每次调用 N 次 parse**,即便最后只命中 1 条
- 整个 codebase 调了 **39 处**(`grep queryNodes\\(`),热路径包括 dashboard、daily-report、escalation、reminders、conflicts、hermes 共 5 个后台扫描 + 用户请求
- 10 k attackTickets 时单次调用 ~150-300 ms,触发 N+1 后(如 hermes recent-changes)秒级响应
- **PG + `properties JSONB` + GIN 索引 `(nodeType, properties)` 后,这是 10-100 倍提升的最大单点**

### 2. `conflicts.syncConflicts` — 全量重建 O(N + k²)(`conflicts.ts:39-76`)
```ts
repo.deleteEdges({ edgeType: "CONFLICTS_WITH" }, actor);
repo.deleteEdges({ edgeType: "OVERLAPS_WITH" }, actor);
// ... C(k,2) 双向 createEdge for each group
```
- 每次都 `deleteEdges` + 重新生成所有衍生边
- **每张 attackTicket 创建/更新都 setImmediate 触发一次**(`routes.ts:22, triggerPostSaveJobs`)
- 同一负责人 50 张活跃单 = 50·49/2 = 1225 对 × 2 方向 = **2450 次 createEdge**,每次写 audit_log
- 用户连续创建 10 张攻关单 = 10 次全量重建 = **数万次 INSERT**
- 应做:增量(只算受变更影响的 group),或防抖(debounce + 队列)

### 3. `recommend.recommendHelpers` — 嵌套 N+1(`recommend.ts:43-53`)
```ts
for (const c of repo.queryNodes("contribution")) {           // 全扫
  for (const pid of refPersons(repo, c.id, "贡献人")) {       // 每条 → queryEdges
    ...
  }
}
```
- 5 k contributions × `queryEdges({sourceId})` 内部 `SELECT * FROM edges WHERE sourceId=?`(走索引 idx_edges_source) ≈ **5 k 次 SQL round-trip**
- 同步 better-sqlite3 下约 200-500 ms;若换异步驱动每次 1-3 ms 网络,直接秒级
- 应做:`JOIN edges ON contribution.id` 一次性取出

### 4. `proposer.HeuristicRelationProposer.propose` — O(N²·L²)(`proposer.ts:23-50`)
```ts
for (let i = 0; i < nodes.length; i++)
  for (let j = i + 1; j < nodes.length; j++)
    const dist = levenshtein(A.key, B.key);  // O(L²)
```
- 每个 ref nodeType(主要是 person)的所有节点两两 levenshtein
- 1 k persons = **499 500 次 levenshtein**,每次 L≈10 字符 → ~5 千万 cell 操作
- 由 `runProposalScan` 在 `jobs.tick`(每小时)调用 — 现网无感,但 5 k 人时直接卡死 jobs
- 应做:locality-sensitive hashing(MinHash / n-gram blocking),只在同 block 内两两

### 5. `hermes.answerQuestion` fallback — 跨类型全扫 + substring 计数(`hermes.ts:281-292`)
```ts
for (const nt of registry.getConfig().nodeTypes.map(n => n.nodeType)) {
  for (const n of repo.queryNodes(nt)) {
    const hay = Object.values(n.properties).map(v => String(v)).join(" ").toLowerCase();
    let score = 0, i = hay.indexOf(needle);
    while (i !== -1) { score++; i = hay.indexOf(needle, i + needle.length); }
  }
}
```
- 17 个 nodeType × N 节点 × Object.values + join + indexOf 循环
- 每个 Hermes 不命中具体 intent 的问题都触发,且**无缓存**
- 100 个 nodeType 共 30 k 节点时单次 ≈ 1.5-3 s
- **PG 后改 `to_tsvector('chinese', search_text) @@ to_tsquery`** + GIN 索引,毫秒级

### 6. `appendProgress` 的 seqNo 竞态(`repository.ts:146-149`)
```ts
const max = this.db.prepare(`SELECT MAX(seqNo) m FROM progress_log WHERE ownerId=?`).get(ownerId);
p = { ..., seqNo: (max?.m ?? 0) + 1, ... };
this.db.prepare(`INSERT ...`).run(...);
```
- 包在 `db.transaction(...)()` 里,better-sqlite3 同步执行 + SQLite 写锁 → 安全
- **任何异步迁移(PG/独立 Worker)瞬间变成经典 race**:两个事务读到同一个 MAX,各自 +1,INSERT 撞主键或产生重复 seqNo
- 标准修法:`UNIQUE(ownerId, seqNo)` + 失败重试,或单独 `progress_seq(ownerId, next_seqno)` 行级锁

### 7. `dashboard` + `daily-report` 全表 + 全 progress 扫(`dashboard.ts:14-67`, `daily-report.ts:42-86`)
- Dashboard 一次:`queryNodes(attackTicket)` + `queryNodes(contribution)` + `listAllProgress()` + `listConflictRows`(又一次 `queryNodes(attackTicket)`)+ `listProposals({待审批})`
- daily-report 同样 `queryNodes(attackTicket)` + `listAllProgress()` 然后按 owner group
- **一次 dashboard 加载 ≈ 全库扫 5 次**,1 万节点 → 500 ms-1.5 s
- 应做:dashboard summary cache(60 s TTL),或物化视图

### 8. `useSettings` 缺缓存(`apps/frontend-v2/src/hooks/useSettings.ts:8-14`)
```ts
useEffect(() => {
  api.listSettings().then(...);
}, []);
```
- **13 个文件 useSettings()**,每次组件挂载都 fetch
- 导航切页 = `/api/settings` 又一次往返
- CLAUDE.md 注释 "useSettings 5min cache" 是**计划目标,代码尚未实现** — TTL/dedupe/SWR 都缺
- 应做:module-level singleton promise + TTL,或迁到 React Query / SWR

## 短期可上 PG 后的收益预估

| 项 | SQLite 现状 | PG + JSONB + GIN | 倍数 |
|----|------------|------------------|------|
| `queryNodes(attackTicket, {状态: "处理中"})` @ 10 k 节点 | ~ 300 ms(全扫 + 全 parse) | ~ 5-15 ms(走 GIN `properties @> '{"状态":"处理中"}'`) | **20-60×** |
| `queryNodes(person, {邮箱: "x"})` @ 5 k 人(`routes.ts:79` 私密授权组里 N²) | ~ 80-200 ms 单次,在嵌套循环里 × N | ~ 1-3 ms 单次 | **30-100×** |
| Hermes fallback 全文搜索 | ~ 1.5-3 s | **`to_tsvector` + GIN**:10-50 ms | **30-300×** |
| Dashboard 加载 | ~ 500-1500 ms | 50-150 ms(配合 JSONB 索引和并发驱动) | **10×** |
| 并发写 QPS | < 50(全局锁) | ~ 1 k(MVCC + row lock) | **20×** |
| Conflicts 重建(全量删建) | 主要瓶颈是 audit 写放大 | 略快,但**算法本身是瓶颈** — PG 救不了,要改增量 | ~2× |
| Proposer levenshtein N² | 5 k 人 → 卡死 | 同样卡死 | **1×**(需算法改造,DB 无关) |

**核心结论**:PG 解决 80% 的"查询慢"问题,但 **`conflicts` 全量重建 + `proposer` N² + `recommend` N+1 + `useSettings` 无缓存 + `dashboard` 全扫**这五个是**算法/架构**问题,换 DB 也不快。先改算法,再迁 DB,投入产出比最高。

## 韧性强项 + 弱项

### 强项 ✓
1. **systemd `Restart=always` + `RestartSec=5`**(`combat-v2-direct.service:13-14`)— 进程崩溃自愈,boot 自启
2. **日志纪律**:104 处 `log.{info,warn,error}`,每个 HTTP 请求 + 每个后台扫描 + 每次审计点都有事件,grep 即可定位
3. **`asyncHandler` 包装异步路由**(`logger.ts:52-59`)— Express 4 不会吞掉 async throw,这一点很多团队没做
4. **`audit_log` 表 + `repo.logAudit`** 是业务级时光机,21 类事件可回溯,合并/升级/状态流转都留痕
5. **Hermes 双引擎容灾**(`hermes.ts:326-334`)— agent 失败/超时静默回退规则引擎,有 timeout 兜底,**契约稳定**
6. **备份两阶段 restore**(`backup.ts:121-127`,`server.ts:18 applyRestorePending`)— 上传暂存 + 重启原子切换 + 保留 `.pre_restore`,可回滚
7. **JWT stateless**(`auth.ts`)— 重启不掉登录,水平扩无 session 障碍(可惜单进程下用不到)
8. **`COMBAT_DB_PATH` 在 deploy 路径外**(`combat-v2-direct.service:10`)— `rm -rf /opt/combat-v2/{src,...}` 不会误删数据
9. **`triggerPostSaveJobs` 用 setImmediate 异步**(`routes.ts:21`)— 不阻塞用户响应

### 弱项 ✗
1. **无 healthcheck endpoint** — systemd 只知道 PID 在不在,无法识别"进程在但卡死"
2. **无 metrics / Prometheus** — p99、错误率、queue depth 全是看 log 估算
3. **`backend.log` 无 rotation** — `StandardOutput=append:...` append-only,长期跑撑爆磁盘,需手动 logrotate(未配置)
4. **无 rate-limit / circuit-breaker** — 一个用户狂点导入接口能拖垮全站
5. **`express.json({ limit: '20mb' })` 配合无并发限制** — 攻击向量,内存可被打爆
6. **后台 setInterval 错误只 log 不告警**(`server.ts:39-47`)— `auto_scan.escalation.fail` 一旦持续,无人知
7. **`logAudit` 单条 INSERT,每个 conflict 重建写百千条**(`conflicts.ts:127, repository.ts:8-14`)— 写放大严重,DB 大小线性膨胀
8. **`tsx` 跑生产** — 不是 build artifact,启动慢、内存占用比 build 大,运维角度不专业
9. **单进程 = 单点** — 部署期 100% 不可用,RTO ≈ deploy 时长(数十秒到分钟)
10. **无异地备份** — backups 和 db 在同一台机,机器丢 = 数据丢;`keepCount: 4 × 168h` 默认只保留 4 个周备份
11. **Hermes 超时 180 s 默认** — 用户体感太长,且 HTTP 请求被卡住占连接
12. **`runScheduledBackup` 在主进程同步执行 `db.backup()`**(`backup.ts:154`)— 大库时阻塞主循环,期间所有 API 请求等待

## 优先级修复路线图(若我来排期)

### P0(本周可做,不需要架构改动)
1. **加 `GET /health`**:返回 `{ ok, dbSize, uptime, lastBackupAt }`,systemd 配合 `ExecStartPost` watchdog
2. **`useSettings` 加 module-level singleton + 5 min TTL** — 减 90% 重复请求,代码 < 20 行
3. **`useSettings` 改 `Promise<settings>` 共享**:多个组件同时挂载只发 1 个请求
4. **`logrotate` 配置 + log rotation**:`/etc/logrotate.d/combat-v2`,daily + keep 30
5. **`conflicts.syncConflicts` 防抖**:setImmediate → 100 ms 合并窗口,N 次保存合并成 1 次重建

### P1(下周做)
1. **`dashboard` summary 60 s TTL cache**(in-memory)— 顶级页面一次刷新成本降 95%
2. **`recommend.recommendHelpers` 改 1 次 `repo.queryEdges({edgeType:"REF"})` 全量,内存 join** — 消灭 N+1
3. **Hermes 默认 timeout 30 s,fallback 阈值 10 s**
4. **加 rate-limit 中间件**(`express-rate-limit`)— 默认 100 req/min/IP,导入/导出特殊豁免

### P2(下月)
1. **迁 PostgreSQL**,`properties JSONB` + `CREATE INDEX ... USING GIN (properties)`
2. **`search_text` → `tsvector`** + GIN — Hermes fallback 进入毫秒级
3. **Build step**:`tsc` 出 dist,生产跑 `node dist/server.js`(`tsx` 留 dev)
4. **后台扫描挪到独立 worker 进程**(同库,通过 SQLite/PG 协作)— 主进程专注 API
5. **Conflicts 增量算法**:只对变更 ticket 的 group 局部重算

### P3(改架构)
1. **容器化 + K8s**,后端 stateless,DB 外置(PG-RDS)
2. **Prometheus exporter** + Grafana dashboard
3. **异地备份**(rclone → S3/OSS)
4. **蓝绿部署**,实现 zero-downtime

## 一句话总结

**当前架构是一个写得很认真、日志很自律、对自己的边界很诚实的"单机版"**。在 100 用户 / 几千节点的内部小工具语境里它打 7-8 分;一旦预期上升到"几万节点 / 几十并发用户 / 跨地域 HA",当前实现要重做的不是 DB,而是**算法热点 + 缓存策略 + 横向扩展能力**。PG 切换是必要不充分条件,真正要先动的是 `queryNodes` 之上的那 39 个全表扫调用点。
