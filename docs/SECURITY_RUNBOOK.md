# 安全运营手册 (Security Runbook)

> 适用范围: combat-platform v2.2+ (P0 + P1 安全加固落地后)。
> 现网部署目标: `124.156.193.122` ,详见 [CLAUDE.md → Deployment](../CLAUDE.md#deployment)。

本手册面向运营和事故响应,覆盖三类问题:**日常预防 / 异常监测 / 入侵响应**。

---

## 0. 启动期必备环境变量

部署到生产环境前 (`NODE_ENV=production`) , 以下变量必须通过 systemd `EnvironmentFile=` 注入,否则后端会拒绝启动 (`process.exit(1)`):

| 变量                        | 必填            | 取值                                            | 用途                                                       |
| --------------------------- | --------------- | ----------------------------------------------- | ---------------------------------------------------------- |
| `JWT_SECRET`                | 是 (production) | 32+ 字节随机串 (e.g. `openssl rand -hex 32`)    | JWT 签名密钥;默认值会被 `auth.ts` 启动检查拒绝             |
| `COMBAT_ENCRYPT_KEY`        | 否 (推荐)       | 32 字节 base64 (e.g. `openssl rand -base64 32`) | SMTP 密码 AES-256-GCM 加密 key;不设则 derive 自 JWT_SECRET |
| `NODE_ENV`                  | 是              | `production`                                    | 触发严格模式 + CORS 同源 + CSRF 校验                       |
| `COMBAT_RATE_LIMIT_PER_MIN` | 否 (默认 60)    | 整数                                            | 全局 IP 限流上限,如有反代请提高或关闭                      |
| `COMBAT_NO_AUTH`            | **禁止**        | -                                               | 仅 e2e 测试使用,生产环境绝不可设;运维误开则全鉴权失效      |

### 部署前自检脚本 (建议放在 CI gate)

```bash
ssh root@124.156.193.122 'systemctl show combat-v2 -p Environment'
# 输出必须包含 JWT_SECRET=... 且非默认值;且不包含 COMBAT_NO_AUTH=1
```

---

## 1. 日常监测 (周巡检)

### 1.1 默认管理员密码是否已修改

```bash
ssh root@124.156.193.122 'sqlite3 /opt/combat-v2/combat.db "SELECT username, substr(password_hash,1,15) FROM users WHERE username=\"admin\";"'
```

若 `password_hash` 仍为 `admin123` 对应 bcrypt 输出 — 即时让管理员登录强制改密(P1 改密 Modal 会自动弹出)。

### 1.2 SMTP 配置是否已加密

```bash
ssh root@124.156.193.122 'sqlite3 /opt/combat-v2/combat.db "SELECT value FROM app_settings WHERE key=\"smtp\";" | head -c 200'
```

输出的 JSON 里 `password` 字段必须形如 `"enc:v1:..."` (base64)。若仍是明文,在后端启动时迁移会自动跑;若长期未迁移,可手动重启服务触发:

```bash
ssh root@124.156.193.122 'systemctl restart combat-v2'
```

### 1.3 异常登录监测

```bash
ssh root@124.156.193.122 'grep "auth.login" /opt/combat-v2/backend.log | tail -50'
ssh root@124.156.193.122 'grep "csrf.blocked\|admin_denied\|leader_denied" /opt/combat-v2/backend.log | tail -50'
```

- 同 IP 1 分钟内 ≥ 10 次 `auth.login` 失败 → 怀疑爆破;查看 rate-limit 是否生效 (登录已 5/15min 限流)
- `csrf.blocked` 多条 → 怀疑钓鱼 / 跨站请求
- `admin_denied` / `leader_denied` → 怀疑越权探测

### 1.4 依赖 CVE

```bash
cd /path/to/repo
npm audit --registry https://registry.npmjs.org
```

已知未清零 (跟踪表):

| 包     | 版本   | CVE                                       | 处理                                                                        |
| ------ | ------ | ----------------------------------------- | --------------------------------------------------------------------------- |
| `xlsx` | 0.18.5 | GHSA-4r6h-8v6p-xvw6 / GHSA-5pgg-2g8v-p4x9 | npm 末版本无补丁;计划 v2.3 替换为 `exceljs` 或切到 SheetJS 官方 CDN tarball |

---

## 2. 异常响应剧本

### 2.1 怀疑 admin 凭据泄露

1. **立即** 登录后端,在 `users` 表里手动改 admin 密码:
   ```bash
   ssh root@124.156.193.122
   cd /opt/combat-v2
   node -e "const b=require('bcryptjs'); console.log(b.hashSync('NEW-STRONG-PWD', 10))"
   # 把输出的 hash 写入:
   sqlite3 combat.db "UPDATE users SET password_hash='<hash>' WHERE username='admin';"
   ```
2. **吊销现有 JWT**:rotate `JWT_SECRET` 后重启 — 所有现有 token 立即失效。
   ```bash
   # 编辑 EnvironmentFile,改 JWT_SECRET
   systemctl restart combat-v2
   ```
3. 拉 `auth.login` + `node.*` + `auth.user_*` 三类日志,过 IP / time / username 维度对账。

### 2.2 SMTP 凭据怀疑泄露

1. 立即吊销 SMTP 账号 (邮箱服务商控制台)。
2. 后端在 EmailSettings 页面填新凭据(自动加密入库)。
3. 检查日志 `email.send` 看是否有可疑收件人。

### 2.3 备份文件被下载

1. 已知备份文件名 → 立即:
   ```bash
   ssh root@124.156.193.122 'rm /opt/combat-v2/backups/<filename>'
   sqlite3 combat.db "DELETE FROM audit_log WHERE entityType='backup' AND entityId='<filename>';"
   ```
2. 把所有 bcrypt hash 视为已泄露 — **强制全员改密**(在 UserManagement 页面批量重置)。
3. `JWT_SECRET` rotate (见 2.1)。
4. 如果备份里有未加密的旧 SMTP 配置 → 走 2.2。

### 2.4 私密 ticket 被异常访问

```bash
ssh root@124.156.193.122 'grep "node.create\|node.update" /opt/combat-v2/backend.log | grep "<ticketId>"'
```

定位 actor → 关联 `auth.login` IP → 决定是否吊销该账号。

---

## 3. 入侵响应 (Suspected Breach)

### 3.1 立即隔离

```bash
# 1. 停业务进程,保留日志和数据
ssh root@124.156.193.122 'systemctl stop combat-v2'

# 2. 快照 DB + 日志 (取证)
ssh root@124.156.193.122 'tar czf /tmp/forensic-$(date +%s).tar.gz /opt/combat-v2/combat.db /opt/combat-v2/backend.log* /opt/combat-v2/backups/'

# 3. 下载快照到本地分析机
scp root@124.156.193.122:/tmp/forensic-*.tar.gz ./
```

### 3.2 rotate 全部密钥

- `JWT_SECRET` → 新值,所有现有 JWT 立即失效
- `COMBAT_ENCRYPT_KEY` → 新值;SMTP 老密文将无法解密,需要在 EmailSettings 重填密码
- DB admin 密码、SMTP 服务商密码、systemd EnvironmentFile 注入密码 — 全部 rotate

### 3.3 重建

1. 用 git tag / 最近一个干净的 `git archive HEAD` 重新部署
2. 从最近的可信备份恢复业务数据;但 **不要恢复 users 表**(假定 hash 已泄露)
3. 强制所有人重新注册 / 改密
4. 复盘到 `docs/INCIDENTS/<date>.md`

---

## 4. 测试 / 部署期常见疑问

- **Q: COMBAT_NO_AUTH 何时使用?** A: 只在本机 e2e (`playwright.config.ts` webServer env);生产 systemd Unit 必须不含此变量。
- **Q: JWT_SECRET 多久轮换一次?** A: 至少一年一次;凡是怀疑泄露立即轮换。轮换会让所有用户 logout 重登。
- **Q: COMBAT_ENCRYPT_KEY 不设有问题吗?** A: 没硬伤,会 derive 自 JWT_SECRET;但二者绑死会让 rotate JWT 时同时摧毁老 SMTP 密文。生产建议显式设两个独立 key。
- **Q: helmet CSP 为什么关掉?** A: SPA + Ant Design 5 inline style + 第三方 CDN 配 CSP 极易踩坑;放在 Nginx 反代层统一设。
- **Q: 全局 rate-limit 60/min 是否过低?** A: 单 IP 单点击页面通常 ≤ 20 req/页(批量初始化时短暂尖峰),正常用户不受影响;如果背后有反代或 CDN,需把真实 IP 透传 (X-Forwarded-For) 否则全部走代理 IP 一个桶。

---

## 5. 相关代码定位

| 模块                 | 文件                                      | 备注                                 |
| -------------------- | ----------------------------------------- | ------------------------------------ |
| JWT 启动校验         | `apps/backend/src/auth.ts:17`             | resolveJwtSecret                     |
| 默认密强制改密       | `apps/backend/src/auth.ts:123`            | login 返回 passwordMustChange        |
| 全局/登录 rate-limit | `apps/backend/src/app.ts`                 | helmet + express-rate-limit          |
| CSRF 同源校验        | `apps/backend/src/csrf.ts`                | Origin/Referer 校验                  |
| 私密单全集过滤       | `apps/backend/src/private-tickets.ts`     | list/export/audit/dashboard 复用     |
| SMTP 加密            | `apps/backend/src/crypto.ts`, `email.ts`  | AES-256-GCM + 启动期迁移             |
| audit actor 强制     | `apps/backend/src/repository.ts:logAudit` | req.user 优先于调用方传字符串        |
| 路由 actor helper    | `apps/backend/src/routes.ts:actorOf`      | 统一 req.user.username \|\| fallback |
