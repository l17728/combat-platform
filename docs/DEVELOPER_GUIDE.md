# 开发上手指南

> 面向贡献者。架构原则 + 扩展模式 + 命令 + 调试。PRD.md 是单一权威开发依据；本文档是导航/速查。

## 1. 仓库布局

npm workspaces 单仓三包：

```
D:\fighting
├── packages/shared/          # @combat/shared (TS 源,无 build) — 类型契约
├── apps/backend/             # Express + better-sqlite3 (sync)
├── apps/frontend/            # React + TS + Vite + AntD
├── config/schemas/           # JSON 配置驱动的 EntitySchema（每个 nodeType 一份）
├── docs/                     # 本文档 / USER_MANUAL / API_REFERENCE / superpowers 计划
├── scripts/deploy/           # ssh2 远程部署器（凭据在 .env.deploy，gitignore）
└── PRD.md                    # 单一权威开发依据
```

## 2. 核心架构（PRD §0）

1. **一个数据模型 + 多个 view**。view 是同一模型的不同投影；从不每表造一套 CRUD。
2. **配置驱动 schema（零 DDL）**：`config/schemas/*.json` 描述每个 nodeType 的字段；业务字段存 `nodes.properties` JSON 列；新增/删除字段是配置变更，不是 DB migration。
3. **混合数据模型**：
   - **结构化模型 = 唯一权威写路径**。所有写经 `validateNode` + repo + audit。
   - **KG = 派生层**。`REF`/`ANCHORED_TO` 边自 `syncRefEdges`/`syncAnchorEdges` 在写入时派生；任何时候可重建。**KG 不接受直接写入**。
4. **显式优先 → 模糊兜底 → 并集检索**。能明确的走 schema；不能明确的走 KG 模糊（增量3c：必经人工审批门后才落库）；查询给出并集（确定+待审标注来源/置信度）。
5. **领域语言中文**：枚举值/字段 id 是中文字面（如 `状态 ∈ {待响应,处理中,进行中,已解决,已关闭}`），verbatim 不译。

## 3. 扩展模式（按"我想做什么"索引）

### 加一个 nodeType（新业务实体）
**零代码**：在 `config/schemas/` 加一份 JSON（参考 `releasePackage.json`/`weightFile.json` 作为最小示例）。泛型 CRUD/导入/导出/检索/REF/ANCHORED_TO/related/找帮手 全部自动适用。前端：在 `App.tsx` 加一个 `<Route ... element={<EntityTable nodeType="xxx" />} />`，AppShell + HomePage 加导航+卡片即可。

### 加一个字段
- UI 在 EntityTable 表头「+字段」即可（持久化到 config/schemas/<type>.json）。
- 或手编 JSON 加一个 `{id,name,type,label,...}` 条目。
- `type` 支持：`string` / `number` / `date` / `datetime` / `enum`（需 `enumValues`）/ `ref`（需 `refType`）/ `sequence`。
- 可选语义：`required` / `aliases`（导入归一）/ `concept`（异名同语义跨 view 归并）/ `anchor`（共享原子，跨颗粒度派生）/ `retired`。

### 加一条业务规则
- 检索/推荐/日报类（只读派生）→ 在 `apps/backend/src/{query,recommend,daily-report,rules}.ts` 模式参考。模式：reader 原语（`queryNodes/queryEdges/listProgress`）+ 确定性算法 + 单元/e2e 测试 + audit 不变断言。
- 关系发现类（产生候选关系）→ 实现 `RelationProposer` 接口（`packages/shared/src/repository.ts`），在 `proposals.ts` 注入；scan 写 `proposals` 表，人工审批门生效。
- 提醒/外发类 → 实现一条 `ReminderDraft` 生成在 `rules.ts`；前端 `/reminders` 自动列出新 kind（数据驱动 UI）。

### 加一种通道（真实发送邮件/IM）
实现 `ChannelAdapter`（`packages/shared/src/repository.ts`）：
```ts
export interface ChannelAdapter { send(r: Reminder, actor: string): { sentAt: string }; }
```
然后在 `app.ts` 把 `makeRemindersRouter(deps.repo, deps.registry, /* channel */)` 的第三参换成你的实例。SMTP 凭据请放 `.env.deploy`（gitignored）；不要硬编码。

### 加一个新 HTTP 路由
- 新建 `apps/backend/src/<feature>.ts` 暴露 `makeXxxRouter(deps)`。
- 在 `app.ts` `app.use("/api", makeXxxRouter(...))` 注册（在错误中间件**之前**）。
- 路由内只用 reader 原语 + Repository CRUD。**不在路由层做写**——写永远经 repo（保证 audit）。

## 4. 命令速查

| 任务 | 命令（在仓库根） |
|---|---|
| 安装依赖 | `npm install` |
| 启动后端开发服 | `npm run dev:backend` |
| 启动前端开发服 | `npm run dev:frontend` |
| 跑 shared 单测 | `npm run test:shared` |
| 跑后端 vitest | `npm run test:backend` |
| 跑前端 vitest | `cd apps/frontend && npx vitest run` |
| 跑 Playwright e2e | `npm run test:frontend:e2e` |
| 全套 | `npm run test:all` |
| shared tsc 校验 | `npx tsc -p packages/shared/tsconfig.json --noEmit` |
| backend tsc 校验 | `cd apps/backend && npx tsc -p tsconfig.json --noEmit` |
| frontend 生产构建 | `cd apps/frontend && npx vite build` |
| 部署到测试服 | `cd scripts/deploy && node deploy.mjs deploy` |

## 5. 测试纪律（PRD 核心原则）

- **TDD**：先写失败测试 → 跑确认 RED → 最小实现 → GREEN → commit。
- **完备 e2e 覆盖**：每个用户可见功能必须有 Playwright e2e；后端规则/API 有 supertest e2e。
- **覆盖审计门**：每个增量 Gate 都做一遍"所有用户可见功能 × 现有 spec"扫，补齐零覆盖项。
- **test:all 连续两次全绿** 是 acceptance 必要条件（Playwright e2e 跑前先清 `:3001 :5173` 端口；详见 §7 调试）。
- **零回归**：任何 PR 不允许减少既有断言（受保护更新需在 PRD/§commit 显式说明"有意识更新"）。

## 6. 部署纪律

- 每个增量 acceptance 通过后部署到测试服（http://www.catown.cloud:5173/）由用户手工验证。
- 部署脚本 `scripts/deploy/deploy.mjs` 通过 ssh2 把当前 git HEAD（含 schema 配置）打包到 47.103.99.229 并启动 Node 22 + better-sqlite3。
- **凭据永远不入 git**：放 `.env.deploy`（gitignored）。

## 7. 调试速查

| 现象 | 原因 / 修法 |
|---|---|
| `EADDRINUSE :3001` 或 Playwright "localhost:3001 already used" | 上次跑遗留 backend 进程；PowerShell `Get-NetTCPConnection -LocalPort 3001,5173 -State Listen \| Stop-Process -Force` 后重跑 |
| 跑 Playwright 后 `config/schemas/*.json` 多了 `concept: ""` / `anchor: ""` / 新字段 | Playwright spec 通过 `PATCH /api/schema` 改了 seed；harness 在 backend 启动前 git-restore，但跑完不会自动 restore。手工 `git checkout -- config/schemas/`。 |
| backend tsc 报某 SqliteRepository 方法缺失 | shared 加了新 Repository 方法但实现尚未跟上。流程：T1（shared 加契约）→ T2（SqliteRepository 实现）→ ... |
| e2e 中 AntD Select / DatePicker 命中两个元素 | strict-mode 多匹配；用 `getByRole("combobox", { name: ... })` 或 `.first()` 锚定第一个 |
| `navigator.clipboard.writeText` 在 headless 中无效 | 用 `page.addInitScript(() => Object.defineProperty(navigator, "clipboard", {value: ..., configurable: true}))`；不要 `(navigator as any).clipboard = ...`（非可写属性） |
| 后端 e2e 想加载真实 `config/schemas/` | 用 `import.meta.url` 解析绝对路径，不要用 `process.cwd()`（vitest cwd 因 workspace 而异） |
| 多 schema 时一个文件损坏阻塞启动 | §13#9 fix（增量12）：`reload` 已容错；损坏 sibling 仅 `console.warn` 跳过。**仅当全部文件损坏**才抛错 |

## 8. 写新增量的标准流程（subagent-driven）

1. 用户提需求 / 我提议下一增量。
2. **PRD §N**：在 PRD.md 末尾追加章节，含 §N.0 范围/§N.1 契约/§N.2 后端/§N.3 前端/§N.4 测试/§N.5 决策/§N.6 验收标准。把推荐决策**明确锁定**（不用占位）。
3. **写 plan**：`docs/superpowers/plans/<date>-<topic>.md` 含 T1（shared 契约 serial gate）→ Wave-1 并行 T2（后端）/T3（前端）→ Gate。
4. **并行 worktree 执行**：`git worktree add .worktrees/<x> -b <branch> <T1-commit>`；同一消息中并行 dispatch T2/T3 子代理（带完整 task 文本，不读 plan）；每个子代理在自己的 worktree 用 TDD。
5. **集成 + 双评审**：merge → 跑 test:all 验整合 → 并行 spec-compliance + code-quality review（受 rate-limit 影响时控制器自审）。
6. **覆盖审计门**：每个用户可见功能 × 既有 spec，缺则补。
7. **test:all 连续两次全绿**（每轮前端口预清）。
8. **§N.6 验收**：把 `- [ ]` 翻成 `- [x]` 引证据；空提交 `chore(accept): ...`。
9. **tag**：`git tag -a increment-N-<slug> -m "..."`。
10. **部署**：`cd scripts/deploy && node deploy.mjs deploy` → 验证 http://www.catown.cloud:5173/ 200 + in-server backend/frontend=200。
11. 给用户简洁的完成报告 + 路线图剩余 + 待决策点。

## 9. 已交付增量索引（按时序）

| # | 标签 | PRD § |
|---|---|---|
| 3b | `increment-3b-concept` | §19 |
| 3c | `increment-3c-proposals` | §20 |
| 3d | `increment-3d-anchors` | §21 |
| 4 | `increment-4-hermes-query` | §22 |
| 5 | `increment-5-find-helper` | §23 |
| 6 | `increment-6-dashboard` | §24 |
| 7 | `increment-7-archive` | §25 |
| 8 | `increment-8-incremental-import` | §26 |
| 9 | `increment-9-daily-report` | §27 |
| 10 | `increment-10-reminders` | §28 |
| 11 | `increment-11-ccb-reminder` | §29 |
| 12 | `increment-12-tolerant-reload` | §30 |
| 13 | `increment-13-sql-pushdown` | §31 |
| 14 | `increment-14-docs`（本增量） | — |
