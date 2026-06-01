# 系统升级机制 (v2.3 "一键升级")

> 部署版本之间的迁移工具:**用 UI 上传新版本包 → 自动 backup → 合并 schema → 替换代码 → 重启 → 健康检查**,任一步失败自动回滚。

## TL;DR

```
admin 登录 → 系统管理 → 系统升级
  ① 拖入 .tar.gz 升级包(最大 100MB)
  ② 自动 analyze,展示 diff 报告(用户字段保留清单、冲突、breaking)
  ③ 勾选确认 + 输入 "UPGRADE" → 执行
  → Progress 条 + 实时 log(轮询)
  → done / failed (自动 rollback) / rolled-back
```

## 架构

### 三个文件分层

| 层                 | 路径                                             | 谁负责        | 升级时怎么处理      |
| ------------------ | ------------------------------------------------ | ------------- | ------------------- |
| **代码 baseline**  | `apps/` `packages/` `config/schemas/` `scripts/` | 升级包        | 整盘 rsync 替换     |
| **用户态 overlay** | `data/schemas-overlay/*.json`                    | UI 用户加字段 | 跨升级保留,三方合并 |
| **业务数据**       | `combat.sqlite`(或 PG) `uploads/` `data/`        | 用户运行时    | 整盘备份,不动       |

### Schema overlay 模型

- `config/schemas/<nodeType>.json` 是 **baseline**(repo 提供,升级跟着换)
- `data/schemas-overlay/<nodeType>.json` 是 **overlay**(用户 UI 加的字段)
- 运行时 `FileSchemaRegistry.reload()` 把两个目录合并:同名字段 overlay 覆盖 baseline,字段带 `source: "baseline" | "user"` 标志

PATCH 字段操作(SchemaWizard 加字段)→ 写到 overlay,baseline 不动 → 升级时整盘替换 baseline,overlay 演化保留。

### 三方合并(schema-merger.mjs)

输入:

- `current_baseline`(当前 repo schemas)
- `current_overlay`(当前用户 overlay)
- `target_baseline`(升级包 schemas)

输出:

- `new_overlay`(替换 current_overlay)
- 报告 JSON:`kept` / `conflicts` / `userTables`

冲突规则:overlay 中的字段名已被 target_baseline 占用 → 列入 `conflicts`,默认保留 user 版本(建议手动评估)。

### Worker (scripts/upgrade/worker.mjs)

**detached Node 进程**,与 backend 进程独立,backend 重启不影响 worker。

阶段:

1. `backup` — tar `config/` + sqlite + `schemas-overlay/` 到 `data/backups/pre-<ts>-<jobShort>.tar.gz`
2. `extract` — 解 staging tar.gz 到 `data/upgrade-staging/<id>-extract/`
3. `schema-merge` — 跑 schema-merger,产出 `new-overlay/`
4. `secrets` — 不存在则生成 `/etc/combat-v2.env`(JWT_SECRET + COMBAT_ENCRYPT_KEY)
5. `code-swap` — `cpSync` 包内 `apps/` `packages/` `config/` `scripts/` 到 `COMBAT_INSTALL_ROOT`(默认 `/opt/combat-v2`),覆盖旧 overlay
6. `restart` — `sudo systemctl restart combat-v2`
7. `health` — 轮询 `/api/health` 30 次 × 1s

每阶段:`writeState({ phase, percent, log })` → `data/upgrade-state.json`,前端 GET `/api/upgrade/status` 实时拉取。

失败任一步 → `tryRollback(backupId)`:解 backup tar 到 install root → restart → state.phase='rolled-back'。

## 端点

| Method | Path                      | 用途                                               |
| ------ | ------------------------- | -------------------------------------------------- |
| GET    | `/api/upgrade/current`    | 当前版本/uptime/DB 大小/用户字段数                 |
| POST   | `/api/upgrade/upload`     | multipart `file` → stagingId                       |
| POST   | `/api/upgrade/analyze`    | `{stagingId}` → diff 报告                          |
| POST   | `/api/upgrade/apply`      | `{stagingId, confirm:true}` → spawn worker → jobId |
| GET    | `/api/upgrade/status`     | 读 state file                                      |
| POST   | `/api/upgrade/rollback`   | 触发回滚                                           |
| GET    | `/api/upgrade/history`    | 读 history file(最近 50 条)                        |
| GET    | `/api/upgrade/log/:jobId` | 纯文本 stream worker 日志                          |

全部 admin-only(`COMBAT_NO_AUTH=1` 放行供 e2e)。

## 升级包格式

最小要求(任选 tar.gz / tgz,根目录或单层套娃都可):

```
upgrade.tar.gz
├── package.json           # 必须;version 字段被读作 targetVersion
├── config/schemas/        # 必须;新的 baseline schemas
├── apps/                  # 推荐;新代码
├── packages/              # 推荐
├── scripts/               # 推荐
└── UPGRADE-MANIFEST.json  # 可选;扩展元信息
```

可选 `UPGRADE-MANIFEST.json`:

```json
{
  "breaking": ["DB 字段重命名 X→Y,旧导出脚本失效"],
  "requiredEnv": ["NEW_API_KEY"],
  "warnings": ["首次启动需要重建 KG"]
}
```

`breaking[]` 在分析报告里以红色 Alert 突出显示,提醒手动评估。

## 生产环境部署

### 一次性准备(配置 sudoers 允许无密码 restart)

```bash
# 添加 /etc/sudoers.d/combat-v2 (root)
cat >/etc/sudoers.d/combat-v2 <<'EOF'
combat ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart combat-v2
combat ALL=(ALL) NOPASSWD: /usr/bin/systemctl status combat-v2
EOF
chmod 0440 /etc/sudoers.d/combat-v2
```

### systemd 服务约定

`combat-v2.service`:

- `WorkingDirectory=/opt/combat-v2/apps/backend`
- `Environment=COMBAT_INSTALL_ROOT=/opt/combat-v2`
- `Environment=COMBAT_SCHEMA_OVERLAY_DIR=/opt/combat-v2/apps/backend/data/schemas-overlay`
- `EnvironmentFile=/etc/combat-v2.env`(JWT_SECRET, COMBAT_ENCRYPT_KEY)
- `Restart=always`

### v2.3.1+ 部署故障排查 — JWT_SECRET 必须注入

v2.3.1 起后端强制要求生产环境 `JWT_SECRET` 必须通过环境变量传入,否则启动失败:

```
[FATAL] JWT_SECRET 未设置,生产环境必须通过环境变量注入随机 32+ 字节密钥
```

systemd drop-in 修复:

```bash
ssh root@<host>
SECRET=$(openssl rand -hex 32)
mkdir -p /etc/systemd/system/combat-v2.service.d
cat > /etc/systemd/system/combat-v2.service.d/jwt-secret.conf <<EOF
[Service]
Environment="JWT_SECRET=$SECRET"
EOF
systemctl daemon-reload
systemctl restart combat-v2
systemctl status combat-v2 --no-pager -l | head -10
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3001/api/health
```

> 长期方案: deploy-direct.mjs 应自动检测 drop-in 缺失时生成,保留 SECRET 在服务器侧(`/etc/combat-v2.env`),不进版本库。

### 现网首次升级前

```bash
# 1) 把现网 schemas/*.json 里"用户 UI 加的字段"挪到 overlay
ssh combat@host
cd /opt/combat-v2
# 用 v2.2 的 baseline 副本作参考点(从 git 取)
git show v2.2.0:config/schemas/attackTicket.json > /tmp/baseline-v2.2/...
node scripts/migrate-schemas-to-overlay.mjs \
  --current  config/schemas \
  --baseline /tmp/baseline-v2.2/schemas \
  --overlay  apps/backend/data/schemas-overlay \
  --apply
```

之后才能用 UI 升级。

## v2.3.1 新增能力

### 1. 在线版本拉取 (GitHub Releases)

- 后端 endpoint: `GET /api/upgrade/releases` → 透传 `https://api.github.com/repos/<owner>/<repo>/releases?per_page=20`
- env 要求:
  - `UPGRADE_GITHUB_REPO=owner/repo` — 必填,未设置时 endpoint 返回 503
  - `GITHUB_TOKEN=ghp_xxx` — 可选,鉴权后命中私有仓库 / 提高速率上限
- 返回结构(已规范化):

  ```json
  [
    {
      "tag": "v2.3.1.0",
      "name": "v2.3.1.0",
      "publishedAt": "2026-06-01T00:00:00Z",
      "body": "release notes…",
      "assets": [{ "name": "combat-v2.3.1.0.tar.gz", "url": "https://…", "size": 12345 }]
    }
  ]
  ```

- UI(系统管理 → 系统升级 → 顶部"在线版本"卡片):
  - Release 下拉 + asset 下拉 + 「拉取并分析」按钮
  - 点击后调 `POST /api/upgrade/upload-from-url`,后端直接下载入 staging,再走 analyze
- CLI: `npm run cli -- upgrade:releases`

> 手动验证:本机加 `UPGRADE_GITHUB_REPO=anthropics/anthropic-sdk-typescript` 启动 backend → 调 `/api/upgrade/releases` 应能拿到真实数据。

### 2. PGP 签名校验

- 升级包约定:`foo.tar.gz` + 同名 `foo.tar.gz.asc`(armored detached signature)
- 公钥优先级:`env UPGRADE_PGP_PUBKEY` > `~/.config/combat/upgrade-pubkey.asc` > `data/upgrade-pubkey.asc`
- 后端流程:
  - `POST /api/upgrade/upload-signature` (multipart `file=.asc` + `stagingId`) — 把签名落到 staging
  - `POST /api/upgrade/analyze` 自动检测同名 `.asc`,若存在则用 openpgp 校验,返回字段:
    - `signaturePresent: boolean`
    - `signatureValid?: boolean` (仅当 present 时)
    - `signedBy?: string` (pubkey 第一个 userID)
    - `signatureError?: string` (失败原因)
- UI 行为:
  - 签名有效 → 顶部绿条 `✓ 签名有效(签名人: xxx)`
  - 签名无效 → 顶部红条 + 「执行升级」按钮默认 disabled
  - 未提供签名 → 顶部橙条警告
  - 红/橙状态下,需勾选「我已确认升级包来源可信,允许在签名不通过的情况下执行升级」才可点击执行
- 独立校验工具(不依赖后端):
  ```bash
  node scripts/upgrade/verify-signature.mjs <pkg.tar.gz> <pubkey.asc> [--sig <pkg.tar.gz.asc>]
  # 退出码 0=有效,1=无效,2=参数/IO 错误
  ```

### 3. 真实演练流程 (Stage E 必跑)

升级机制成熟度的真正考验是「detached worker 在 backend 被 systemctl 杀掉后能否继续完成 phase 5-7 并自动健康检查」。本机用 `COMBAT_UPGRADE_MOCK_SYSTEMD=1` 跳过 systemctl,**不能替代真实演练**。

**演练工具**: `scripts/upgrade/prod-rehearsal.mjs`

```bash
# 默认 dry-run:只做 SSH 可达性 + 当前版本 + 本地打包,不动生产
node scripts/upgrade/prod-rehearsal.mjs

# 完整真跑(危险!)
node scripts/upgrade/prod-rehearsal.mjs --apply

# 完整真跑 + 演练结束后自动回滚到原版本
node scripts/upgrade/prod-rehearsal.mjs --apply --rollback
```

**前置条件**:

- repo 根目录 `.env.deploy` 已包含 `PROD_HOST` / `PROD_USER` / `PROD_PASS`
- 生产服务已经处于 v2.3+(具备 `/api/upgrade/*` endpoint)
- 生产 sudoers 已配置无密码 systemctl restart(见上文「一次性准备」)

**脚本步骤(10 步)**:

| #   | 操作                                                               | 失败行为      |
| --- | ------------------------------------------------------------------ | ------------- |
| 1   | SSH 连接生产                                                       | 退出 2        |
| 2   | curl `/api/upgrade/current` 记录 fromVersion                       | 退出 2        |
| 3   | curl `/api/health` 健康检查                                        | 退出 2        |
| 4   | `git archive HEAD` 本地打包                                        | 退出 2        |
| 5   | SFTP 上传到 `/tmp/combat-upgrade.tar.gz`                           | —             |
| 6   | curl POST `/api/upgrade/upload` 拿 stagingId                       | —             |
| 7   | curl POST `/api/upgrade/analyze` 看 diff                           | —             |
| 8   | curl POST `/api/upgrade/apply` 拿 jobId                            | —             |
| 9   | 轮询 `/api/upgrade/status` 至 done/failed/rolled-back(最长 5 分钟) | 超时 → 退出 3 |
| 10  | 再 curl `/api/upgrade/current` 验证 toVersion                      | —             |

退出码:

- `0` 升级到达 done
- `1` 升级失败但 rollback 成功(可调查 worker 日志)
- `2` 参数 / IO / 凭据错误
- `3` **必须人工介入** — rollback 也失败,需 SSH 手动恢复

### 4. 演练日志

> 集成阶段(Stage E)在此追加每次真实演练记录。

| 日期   | 触发人 | from → to | 阶段(done/failed/rolled-back) | 是否回滚 | 备注   |
| ------ | ------ | --------- | ----------------------------- | -------- | ------ |
| _待补_ | _待补_ | _待补_    | _待补_                        | _待补_   | _待补_ |

### 5. 失败恢复手册

如果演练或正式升级在 phase 5-7 出现以下灾难场景,按这个顺序处理:

#### 场景 A: worker 中途 crash / 被 OOM Killer 杀掉

症状:`/api/upgrade/status` 卡在某个 phase(如 `code-swap` 80%),`backend.log` 没有新的 worker 输出。

恢复:

```bash
ssh root@<host>
# 1. 查 worker 是否还活着
ps -ef | grep worker.mjs
# 2. 若已死,看 worker log 拼接出阶段
tail -100 /opt/combat-v2/apps/backend/data/upgrade-logs/<jobId>.log
# 3. 手动回滚(用之前 backup tar)
cd /opt/combat-v2/apps/backend/data/backups
ls -t pre-*.tar.gz | head -1   # 最近一个 backup
tar -xzf pre-<ts>-<jobShort>.tar.gz -C /opt/combat-v2
systemctl restart combat-v2
# 4. 清掉过时 state file
rm /opt/combat-v2/apps/backend/data/upgrade-state.json
```

#### 场景 B: 网络中断导致 SSH 演练脚本退出但 worker 已起飞

worker 是 detached,SSH 断开不影响。重新 SSH 进去看 `/api/upgrade/status` 即可继续追踪。

#### 场景 C: systemctl restart 失败,新代码已替换但服务起不来

```bash
ssh root@<host>
journalctl -u combat-v2 --no-pager -n 100   # 看 systemd 错误
# 常见原因:依赖缺失 / 端口被占
ss -tlnp | grep 3001
# 若需要紧急上线旧版,走场景 A 的手动 rollback 路径
```

#### 场景 D: 健康检查阶段(phase=health)反复失败 30s 后 worker 自动触发 rollback,但 rollback 后服务依旧不起

这通常是 backup tar 解开后又被新覆盖了——查 `data/backups/` 是否真有 pre-\* 文件。最坏情况:

```bash
ssh root@<host>
cd /opt/combat-v2
git fetch && git reset --hard <last_known_good_commit>
npm ci && npm run build --workspace=@combat/frontend-v2
systemctl restart combat-v2
```

## MVP 限制 (留 v2.3.3)

1. **不支持多机集群升级**:单实例方案;集群需扩展(loadbalancer drain + rolling)
2. **GitHub Release 拉取无离线镜像**:如果生产环境无法访问 github.com,需要预先把 tar.gz scp 上去走本地 upload 路径
3. **签名失败仍可放行**:出于实操便利,UI 允许勾选「允许未签名」放行;如需强制,可在 backend 加入 env `UPGRADE_REQUIRE_SIGNATURE=1` 钩子(后续迭代)

## 故障排查

| 现象                                    | 排查                                                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 上传 400 "升级包必须是 .tar.gz 或 .tgz" | 重命名为 `.tar.gz` 后缀                                                                                                        |
| analyze "schema-merger 失败"            | 检查 staging 解包目录 `data/upgrade-staging/<id>-extract/` 结构                                                                |
| apply 409 "已有升级任务进行中"          | 上一次 jobId 未结束,等它完或人工删 `data/upgrade-state.json`                                                                   |
| restart 阶段超时                        | 检查 `sudo systemctl status combat-v2`;sudoers 是否生效                                                                        |
| health 30s 未通过 → 自动回滚            | 看 backend 是否真起来:`curl localhost:3001/api/health`;看日志 `tail /opt/combat-v2/backend.log`                                |
| 自动回滚失败                            | 状态 = `failed`,backupId 仍可见,手动 `tar -xzf data/backups/<id>.tar.gz -C /opt/combat-v2 && sudo systemctl restart combat-v2` |

## 环境变量

| 变量                          | 用途                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `COMBAT_INSTALL_ROOT`         | 升级目标根目录(默认 worker 用 `process.cwd()/../..`,生产 systemd 设 `/opt/combat-v2`) |
| `COMBAT_SCHEMA_OVERLAY_DIR`   | overlay 目录(默认 `data/schemas-overlay` 相对 backend cwd)                            |
| `COMBAT_UPGRADE_DATA_DIR`     | upgrade state/history/staging/logs 根目录(默认 backend cwd 的 `data/`)                |
| `COMBAT_UPGRADE_MOCK_SYSTEMD` | =`1` 跳过 systemctl + health 探活(本机/e2e)                                           |
| `COMBAT_ENV_FILE`             | secrets 阶段写入路径(默认 `/etc/combat-v2.env`)                                       |
| `COMBAT_HEALTH_URL`           | health 阶段轮询的 URL(默认 `http://127.0.0.1:3001/api/health`)                        |

## systemd drop-in 自动清理 (v2.3.5+)

### 背景

v2.3.4 现网部署中曾出现:多个 `/etc/systemd/system/combat-v2.service.d/*.conf` 同时设置同一 env key(比如 `HERMES_MODEL` 同时出现在 `hermes.conf` 和 `hermes-llm.conf`)。systemd 按字典序加载,后者覆盖前者,但运维改值后老 drop-in 会"偷偷复活",诊断困难。

### 自动行为(默认开启)

`scripts/deploy-v2/deploy-direct.mjs` 在每次部署的 5/5 阶段(daemon-reload 之前)运行 drop-in 健康检查:

1. 拉 `/etc/systemd/system/combat-v2.service.d/*.conf` 文件列表 + 内容
2. 解析每个文件的 `Environment=KEY=VAL` 行,提取 env key
3. 检测同一 key 出现在多个文件 → 冲突
4. 决策:
   - `hermes-llm.conf` 是 v2.3.5 起的**权威** drop-in,优先级最高
   - 若冲突文件包含权威 → 非权威文件改名 `.bak.<timestamp>` 备份后从加载链移除
   - 若无权威 → 字典序最后一个胜出,其余备份
5. 输出日志 `drop-in.cleanup removed=<list> kept=<list>`

实际清理只是 `mv name.conf name.conf.bak.<ts>`,不删数据,**可随时回滚**。

### 关闭自动清理(谨慎模式)

部署时加 `--keep-old-drop-ins` flag:

```bash
node deploy-direct.mjs 124.156.193.122 root <password> --keep-old-drop-ins
```

适用于:确知存在多个 drop-in 但你**就是要这种覆盖关系**(如临时灰度)。日常生产部署应保持自动清理开启。

### 单测

纯 parser/planner 逻辑由 `scripts/deploy-v2/dropin-cleanup.mjs` 导出,在 `apps/backend/test/dropin-cleanup.unit.test.ts` 中有 11 条单测覆盖:多 KEY 引号解析、注释行忽略、混合冲突/非冲突场景、权威/字典序两种胜出策略。
