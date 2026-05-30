# 代码质量 / 工程实践 评审 — by Staff Engineer
日期: 2026-05-30 | 分支: master @ 6783b0fb

## 总评分: 7.4 / 10

一个由"少数高质量人"在 AI 辅助下用 ~6 个月写出的、工程纪律远超同等行业平均水平的小型 monorepo。**配置驱动 + 单数据模型**的架构判断、**CLI 等价于 HTTP API**的工程纪律、以及"小文件多模块 + 路由工厂 + 依赖注入"的后端骨架，质量已经达到中型 SaaS 公司的标杆水平；但**类型安全有明显欠债**（前端 160 处 `any`，后端 87 处）、**前端单测几乎为零**（只有 e2e）、**没有任何 lint/format/CI/pre-commit hook**、**多个 600+ 行的 React 巨型组件**仍在膨胀。**会写代码 ≠ 会维护代码**——当前是前者的胜利，后者的债已经开始显形。

## 量化指标
- 后端代码: **5,998 行 / 56 文件**（中位 ~83 行，最大 448 行 `cli-core.ts`）
- 前端 v2 代码: **12,343 行 / ~80 文件**（最大 `AttackDetail.tsx` 1,065 行，前 5 大页面占 2,688 行）
- 共享包: **643 行**（types.ts 251 + types.test.ts 325 + registry/repository 接口）
- 后端测试: **5,535 行 / 60 文件 / 344 个 it() / 70 个 describe()**（**比例 92% (5535/5998)，几乎 1:1 行数比**）
- 前端 e2e: **6,957 行 / 41 文件 / 396 个 test()**（**前端单测：0**）
- 后端路由: 124 个 `r.xxx(...)` 注册点，跨 ~30 个 router 工厂
- 后端 schema: 18 个 JSON 文件（attackTicket/person/contribution/teamContribution/oncall/…）
- 文档: CLAUDE.md 36KB + AGENTS.md 64KB + docs/ 684KB（10 篇 .md，5,287 行）
- 提交: **445 个 commit**，commit message 规范 (`feat(模块): 描述` / `fix(模块): 描述`)
- 工具链: **无 ESLint、无 Prettier、无 husky/pre-commit、无 GitHub Actions、无 CI**

## 维度评分

| 维度 | 分 | 实证 |
|------|---|------|
| 代码组织 | 8/10 | 后端文件极克制（中位 83 行、最大 448），56 个文件、单一职责清晰；前端 5 个页面 > 400 行属于膨胀但仍可读 |
| 类型安全 | 5/10 | `strict: true` ✓；但后端 87 处 `any` (`r.params` / sqlite 结果)，前端 160 处 `any`（含 `e: any` 在 catch 中），共享接口 `Record<string, unknown>` 是合理设计，但 repository.ts 内部全部 `as any` 拿 sqlite 行 |
| 错误处理 | 7/10 | `asyncHandler` 抓 async throw → next(e) 全局 500，结构良好；但前端 `catch (e: any) { message.error(e.message) }` 千篇一律，没有错误分类/重试/上报；用户面错误确实使用中文 ✓ |
| 测试覆盖 | 8/10 | 后端 344 个 it()/ 5535 行，覆盖每个 router；前端 e2e 396 个 test，覆盖每个页面的列表/筛选/CRUD/导出。**致命短板：前端 0 个单元测试** —— `useFlexTable` / `useSettings` / `teamMembers.ts` / `auditFilter.ts` 这些纯函数 hook 应该有单测但没有 |
| 测试质量 | 7/10 | 后端 `makeTestApp()` 用 tmpdir + COMBAT_NO_AUTH ✓；前端 `helpers.ts` 的 `selectOption` 4 次重试 + 400ms 退避是 hard-won 经验。但**后端测试 60 文件里至少 3 个版本的 `makeApp()`**（`api.e2e.test.ts` 用 helpers，`merge.e2e.test.ts` 自己抄一份，`rbac.e2e.test.ts` 再抄一份）—— `makeTestApp()` 应该是单一来源 |
| DRY | 6/10 | 后端路由工厂 `makeXxxRouter` 模式高度 DRY ✓；但 `repository.ts:60-63` 的 `Object.values(properties).map(...).join(' ')` 出现两次（create + update），`mapProposal`/`mapReminder`/`getNode` 的 row → domain 映射各写各的（差异都是字段名）；前端 catch 块千篇一律 |
| API 设计 | 7/10 | REST 大体一致：GET/POST/PUT/PATCH/DELETE 语义对；状态码体系完整 (201/400/401/403/404/409/500)。但**有些动作型 URL 必然破坏 REST**：`/api/proposals/:id/decide`、`/api/reminders/:id/send` —— 这是务实而非错误，对于"流转"语义比纯 REST 资源建模更清楚 |
| 可观测代码 | 9/10 | `log.info("auth.login", { username, role })` —— event 命名 `模块.动作[.子动作]` 高度一致（94 个事件点，108 处调用），用 `key=value` 行式 grep 友好；`requestLogger()` 自动覆盖每个 HTTP；CLAUDE.md 维护了"日志事件速查"表 —— 这是**标杆级的可观测代码** |
| 依赖管理 | 8/10 | `@combat/shared` 是无依赖纯类型 + 接口包，被 backend 和 frontend-v2 共用，单向依赖清晰；npm workspaces 配置干净（`"workspaces": ["packages/*", "apps/*"]`）；后端只引入了 11 个 runtime dep —— 克制 |
| 工程实践 | 4/10 | **致命：无 ESLint、无 Prettier、无 CI、无 pre-commit hook、无 GitHub Actions、无 PR 模板**。仅靠 CLAUDE.md 里的"必须 git commit 后再 deploy"约定，依赖人/agent 自觉。Commit message 倒是规范 (`feat(模块):`) ✓ |
| 文档 | 9/10 | CLAUDE.md (36KB) + AGENTS.md (64KB) = 工程宪法，把 hard-won 的 Ant Design 5 quirks、Playwright 选择器陷阱、RBAC 怪招都写下来了；docs/API_REFERENCE.md 447 行、docs/DESIGN.md 1190 行 —— 新人 1 天可以独立改 bug，3 天可以做完整 feature |

## 五个"标杆级"做法（可推广）

### 1. CLI 与 HTTP API 真正等价（`cli-core.ts`）
```ts
export interface CliCommand {
  name: string; summary: string; usage: string;
  build: (pos: string[], opts: Record<string, string | boolean>) => HttpRequest;
}
```
CLI 是一张**纯声明式表 + 注入式 `HttpFn`**，每个命令就是 `(pos, opts) => HttpRequest` 的纯函数 —— 完全可单测、零网络耦合。CLAUDE.md 把"每个新 API 同步加 CLI"写成 definition-of-done。这是把"agent-operable"做成工程纪律的范本。

### 2. 路由工厂 + 显式依赖注入（`app.ts`）
```ts
app.use("/api", makeRouter(deps.repo, deps.registry));
app.use("/api", makeImportRouter(deps.repo, deps.registry));
// ... 30+ 个 makeXxxRouter，全部接收同一组依赖
```
没有任何全局单例。`createApp({ repo, registry, db })` 是测试与生产同构的入口 —— `test/helpers.ts` 用 tmpdir + in-memory schema 构造完整应用栈，跑 e2e 不需要 mock。这是 Express 项目的教科书式架构。

### 3. 结构化日志事件命名 + 项目宪法表（`logger.ts` + CLAUDE.md）
```
[2026-05-30T10:00:00Z] INFO auth.login username=zhang role=normal
[2026-05-30T10:00:01Z] INFO node.create nodeType=attackTicket id=abc
```
- event 名 `模块.动作[.子动作]` 全项目一致（94 个 event 点）
- CLAUDE.md 维护一张"日志事件速查"表，告诉运维"看登录日志 grep `auth.login`、看创建日志 grep `node.create`"
- 三层日志架构（文件 / audit_log / op_logs）有明确分工
这种"代码 + 文档"配套的可观测性，在多数 startup 是 P1/P2 时才补，他们一开始就做对了。

### 4. Config-driven schema + 容错 reload（`registry.ts`）
```ts
for (const f of files) {
  try { /* parse */ nodeTypes.push(ns); }
  catch (e) { log.warn("registry.reload.skip", { file: f, error: ... }); }
}
if (files.length > 0 && nodeTypes.length === 0) throw ...;
```
"添加字段是 config 改动，不是 DDL 迁移" —— 加上**单文件破损不拖垮整个 registry** + **写后自校验 + 回滚**（`applyFieldOp`），这是把"零迁移"做到生产级的关键工程细节。多数同类项目要么硬硬写表，要么用 ORM 迁移工具，他们用 JSON 文件 + better-sqlite3 的 properties 列做到了既灵活又安全。

### 5. 测试 hard-won 经验写进 CLAUDE.md（"E2E Test Hard-Won Discoveries"）
CLAUDE.md 里专门一节记录：
- Ant Design 5 自动在 2 字符中文按钮间插空格 → 用正则 `/导\s?出/`
- AntD Select 下拉是 portal，必须 `dispatchEvent('click')` 而不是 `.click()`
- 贡献等级 RBAC：`X-Role` 缺失 = 信任，普通 = 403 —— "测试时用 `localStorage.setItem('combat-role', 'leader')`"

每条都是**真踩过的坑写成 SOP**，新 agent / 新人不必再踩一次。这种"经验显性化"的文档密度，业界少见。

## 五个"应该修但被忽略的"细节（实证）

### 1. `repository.ts` 内部全部 `as any` 拿 sqlite 行 —— 类型安全在最底层断了
```ts
// repository.ts:70, 92, 117, 133, 146, 157, 163, 180, 188-190, 194, 231-242, 246
const r = this.db.prepare(`SELECT * FROM nodes WHERE id=?`).get(id) as any;
return { id: r.id, nodeType: r.nodeType, properties: JSON.parse(r.properties), ... };
```
14 处 `as any`，全部是 sqlite 返回类型断言。should be:
```ts
interface NodeRow { id: string; nodeType: string; properties: string; created_at: string; updated_at: string; }
const r = this.db.prepare(...).get(id) as NodeRow | undefined;
```
一旦数据库列名错拼或新增列遗漏，`as any` 让你拿到 `undefined` 而不是编译错。这是整个项目类型安全最薄弱的地方，**也是修起来最便宜的**（半小时定义 ~10 个 Row interface）。

### 2. `makeTestApp` 三个变体散落各处 —— DRY 红线
- `test/helpers.ts`: `makeTestApp()` 用 in-memory schema (最小 attackTicket + person)
- `test/merge.e2e.test.ts:13-17`: 自己写 `makeApp()` 用真实 `CFG` 目录
- `test/rbac.e2e.test.ts:13-15`: 又写一遍 `make()` 用真实 `CFG` 目录
- `test/automation.e2e.test.ts:14-17`: 又写第四遍

这造成"修了 helper 的人不知道 3 处复制粘贴的存在"。应该是：`makeTestApp({ useRealSchemas: true })` 一个函数解决。

### 3. 前端无单测 + 大组件没拆 —— `AttackDetail.tsx` 1065 行是定时炸弹
- `pages/AttackDetail.tsx`: **1,065 行**，18 处 `any`
- `pages/AttackList.tsx`: 447 行，4 处 `any`
- `pages/Contributions.tsx`: 446 行，10 处 `any`
- `pages/BugReport.tsx`: 493 行，16 处 `any`

这些组件混合了：数据获取 + 表单状态 + Drawer 打开/关闭 + Tab 切换 + 列设置 + 关注列表 + 私密授权 + 状态流转 + 进展同步 + 编辑 + 删除 + 找帮手推荐。**应该按业务关注点拆成 6-8 个 sub-component + custom hook**。没有单测意味着拆的时候没有回归网。

### 4. 前端 catch 全是 `catch (e: any) { message.error(e.message) }`
api.ts 把 HTTP 错误抛成 `Error('HTTP 400 ...')`，前端 60+ 处用 `e: any` 接 —— 类型上正确（`Error.message` 是 string），但**完全没有错误分类**：是网络断了？还是 401 该跳登录？还是 403 该提示"无权限"？还是 409 该提示"重名"？全部弹一个 antd toast 让用户看英文 `HTTP 401 ...`。

建议：`Api.req` 抛 `class ApiError extends Error { status: number; body: unknown }`，前端集中拦截 401 跳登录、403 提示、5xx 上报。

### 5. 无 CI、无 lint、无 pre-commit —— 现状靠 CLAUDE.md 自觉
- 根目录没有 `.github/workflows/`
- 没有 `.husky/`
- 没有 `eslintrc` / `eslint.config.js`
- 没有 `prettier.config.js` / `.prettierrc`

整个项目的"质量门"只有 `npm run test:all`，且**没有 CI 强制运行**。CLAUDE.md 里"部署前必须 git commit"和"修改代码后必须跑测试"完全靠 agent/人自觉。一旦多人协作或 agent 被打断，**必然出现"现网部署了未测试的代码"**。这与项目其他维度的高纪律性形成强烈反差 —— 是当前最大的工程风险。

## 重构建议（投入产出比排序）

### P0 — 1 天能做完，价值极高

1. **给 `repository.ts` 加 sqlite Row 类型，消灭 14 处 `as any`**（半天）
   - 定义 `NodeRow / EdgeRow / ProgressRow / AuditRow / ProposalRow / ReminderRow`
   - 收益：底层类型安全彻底立住，IDE 重命名安全
   - 风险：零（纯类型变化）

2. **加最薄 ESLint + Prettier + 一条 GitHub Actions**（半天）
   - `eslint:recommended` + `@typescript-eslint/recommended` + 禁止 `no-explicit-any` 为 warn（先不 error）
   - GitHub Actions：`npm run test:shared && test:backend && build` —— 跑得快，PR 必过
   - 收益：从此进入"工程化时代"，agent 跑的代码也走同一道门
   - 风险：低（warn 不 error，存量 any 不阻塞）

### P1 — 1 周能做完，长期价值高

3. **统一 `makeTestApp`，消灭 4 个 `makeApp()` 副本**（2 小时）
   - `makeTestApp({ schemas: 'inline' | 'real' })` 一参支持
   - 收益：以后改 helper 不会漏

4. **`api.ts` 抛 `ApiError`，前端集中 401/403/5xx 拦截**（半天）
   - `class ApiError extends Error { status; body; }`
   - `AuthProvider` 监听 401 → 自动跳 `/login`
   - 全局 `axios-like` interceptor 形态（fetch 包装在 `Api.req` 里已有）
   - 收益：用户面错误体验质变

5. **拆 `AttackDetail.tsx` 为 4-6 个子组件**（2-3 天）
   - 抽 `useAttackTicket(id)`, `useProgressTimeline(id)`, `useTransition(node)` 等 hook
   - 子组件：`<TicketHeader>`, `<TicketTabs>`, `<ProgressTab>`, `<RelatedTab>`, `<InfoSquareTab>`
   - **前置**：先写 4-6 个 vitest 单测覆盖核心 hook 行为
   - 收益：可读性、可维护性、AI 辅助修改成功率

### P2 — 中期，价值中等

6. **前端补 vitest 单测**（持续投入）
   - `useFlexTable` / `useSettings` / `useDraggable` —— 这些 hook 现在改一行不知道会不会炸
   - `teamMembers.ts` / `auditFilter.ts` / `nodeLabel.ts` —— 纯函数最适合单测
   - 目标：100 个单测 + 覆盖率门控 60%

7. **README.md 在根目录添加 quick start**（1 小时）
   - 现在新人要看 CLAUDE.md（36KB）+ AGENTS.md（64KB）才能起步，门槛太高
   - 5 分钟 quick start：`git clone → npm install → npm run dev:backend & dev:frontend-v2 → open localhost:5174`
   - 然后链接到 CLAUDE.md / docs/DEVELOPER_GUIDE.md

8. **`pre-commit` hook 跑 `tsc --noEmit` + eslint**（1 小时，依赖第 2 项落地）
   - 用 husky + lint-staged
   - 防止"忘记 commit 就 deploy 部署了类型错的代码"

### P3 — 可选

9. CLI 命令分类与去重（cli-core.ts 已 448 行，有些命令重复语义）
10. 把 `routes.ts` 里的 `canAccessPrivateAttackTicket` 抽到 `auth.ts` 或 `privacy.ts`（业务逻辑 + 测试可单独写）
11. 把 `repository.ts` 里 createNode/updateNode 的 search_text 计算抽成 `buildSearchText(properties)` 工具（DRY）

## 招聘对标

**这是什么级别工程师能产出的代码？**

后端 + 共享层质量稳定在 **Senior (L5)** 区间：路由工厂、依赖注入、容错 schema reload、CLI 等价、结构化日志事件命名 —— 这些不是模板代码，是经验体现。一个写过 2-3 个生产服务的 5-7 年工程师能产出。

前端质量在 **Mid-Senior (L4)** 区间：架构选择（Ant Design + Vite + 单 API client）正确，但巨型组件、`any` 滥用、零单测说明**前端工程化经验弱于后端**。典型的"全栈但偏后端"工程师。

整体加 CLAUDE.md 这种把"经验显性化"成 hard-won SOP 的能力（含"举一反三递归收敛"那种**对自己工作过程的反思**）—— 这是 **Staff (L6)** 的思维特征，但执行层面（缺 CI/lint）还在 Senior。

**新成员加入需要多长时间上手？**

- **改 bug**：1 天。文档极完善，复现 + 定位非常快。
- **加一个完整 feature**：3-5 天。CLAUDE.md 写得很清楚后端 router 工厂 + CLI 同步 + e2e 三件套，照着抄就行。
- **架构级改动（如多租户、分库分表）**：2-4 周。Repository 接口和 SchemaRegistry 都设计得可替换，但 routes.ts 里有些紧耦合需要先拆。

**一个观察**：这个项目极有可能是"1-2 个高手 + AI 辅助"的产物。代码风格高度一致、文档密度反常地高、commit message 全部规范、测试比例反常地高（1:1 行数比） —— 这些特征不像传统团队，更像有纪律的 AI-driven 开发。**如果团队扩到 5+ 人**，缺 CI/lint 这个空档会立刻暴雷；趁现在补，成本最低。
