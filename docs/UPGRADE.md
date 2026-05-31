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

## MVP 限制 (留 v2.4)

1. **仅本地上传**:不从 GitHub Release / 镜像源拉取(后续可加)
2. **无 PGP 签名校验**:用户自己保证升级包来源可信
3. **自我升级真跑需 staging 环境验证一次**:本机/dev 用 `COMBAT_UPGRADE_MOCK_SYSTEMD=1` 跳 systemctl,生产化前必须在测试服务器跑一次真升级,确认 detached worker 在 backend 被 `systemctl restart` 杀掉的情况下继续完成 phase 5-7
4. **不支持多机集群升级**:单实例方案;集群需扩展(loadbalancer drain + rolling)

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
