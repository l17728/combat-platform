# 异地备份 (Offsite Backup)

## 目的

抵御「主机硬盘损坏 / 误删 / 勒索病毒」一类**单点丢失**。本地的 `scripts/deploy-v2/logrotate-combat-v2` 与
`POST /api/backup` 只防进程异常,不防硬件丢失或机房灾害 — 需要把数据周期性地复制到**独立物理位置**。

## 备份内容

每次异地备份打一个 tar.gz,内含以下三类(任一不存在则跳过并在 stderr 警告):

| 类别           | 默认路径                                                    | 说明                           |
| -------------- | ----------------------------------------------------------- | ------------------------------ |
| SQLite 数据库  | `$COMBAT_DB_PATH` 或 `/opt/combat-v2/data/combat.sqlite`    | 业务数据 + 审计 + op_logs 全部 |
| 表结构定义     | `<repo>/config/schemas/`                                    | nodeType JSON 配置             |
| Schema overlay | `$COMBAT_SCHEMA_OVERLAY_DIR` 或 `<db dir>/schemas-overlay/` | UI 期间增量字段                |

> **不含** `node_modules` / 编译产物 / 上传文件 / 日志 — 这些都可由 git 仓库 + 备份重放复原。

## 部署方式

### 1) 终端直跑

```bash
# 用 SSH key (推荐)
node scripts/backup/offsite-backup.mjs \
  --host backup.example.com \
  --user combat \
  --remote-dir /backups/combat-v2 \
  --key /etc/combat-v2/backup_id_ed25519

# 用密码 (仅当 SSH key 不可用)
COMBAT_BACKUP_SSH_PASSWORD=xxx node scripts/backup/offsite-backup.mjs \
  --host backup.example.com --user combat --remote-dir /backups/combat-v2

# 只打包不上传,确认哪些路径会进 archive
node scripts/backup/offsite-backup.mjs --dry-run --host x --remote-dir /tmp
```

### 2) 走后端 CLI (运行中实例)

`backup:offsite` 由 `cli-core.ts` 注册,前提是 backend 进程在跑(本地 `npm run dev:backend` 或现网 systemd):

```bash
npm run cli -- backup:offsite \
  --host backup.example.com \
  --remote-dir /backups/combat-v2 \
  --key /etc/combat-v2/backup_id_ed25519
```

> 通过 CLI / API 调用时,SSH 密码可放在 `$COMBAT_BACKUP_SSH_PASSWORD` 环境变量里(经 backend 透传给子进程)。
> 任何路径覆写都可以放在 `apps/backend` 的环境变量里:`COMBAT_BACKUP_HOST` / `COMBAT_BACKUP_USER` / `COMBAT_BACKUP_REMOTE_DIR` / `COMBAT_BACKUP_SSH_KEY` / `COMBAT_BACKUP_SSH_PASSWORD` / `COMBAT_BACKUP_PORT`.

### 3) 定时任务 (推荐 cron 而不是 systemd timer)

```cron
# /etc/cron.d/combat-offsite — 每天凌晨 3:30 异地备份,日志写本地以便排查
30 3 * * * root COMBAT_BACKUP_SSH_KEY=/etc/combat-v2/backup_id_ed25519 \
  node /opt/combat-v2/scripts/backup/offsite-backup.mjs \
  --host backup.example.com --user combat --remote-dir /backups/combat-v2 \
  >> /opt/combat-v2/offsite-backup.log 2>&1
```

## 远端目录建议结构

```
/backups/combat-v2/
  combat-offsite_20260601_033000.tar.gz   # 每日
  combat-offsite_20260602_033000.tar.gz
  ...
```

清理策略由远端单独处理(避免备份脚本拥有删除权,降低被远控风险):

```bash
# 远端 host 上: 保留 30 天
find /backups/combat-v2 -name 'combat-offsite_*.tar.gz' -mtime +30 -delete
```

## 鉴权与权限模型

- **首选 SSH key**:在备份远端建立专用账号,只授权 `chroot` 到 `/backups/combat-v2`,
  仅写入,不能列目录、不能删除其他文件 (rsync/scp 写专用 SFTP chroot 即可)。
- **不要把生产 SSH key 复用作备份 key**;泄露面应控制在 "可写入备份卷" 这一权能。
- 当前的 `scripts/deploy-v2/deploy-direct.mjs` 仍是密码 SSH;那是部署专用通道,
  与本节备份无关。

## 恢复流程

```bash
# 1) 下载某个备份
scp backup.example.com:/backups/combat-v2/combat-offsite_20260601_033000.tar.gz /tmp/

# 2) 停服 + 备份当前态
systemctl stop combat-v2
mv /opt/combat-v2/data/combat.sqlite /opt/combat-v2/data/combat.sqlite.pre_offsite_restore

# 3) 解包 (脚本把每类放在以 label 命名的目录)
mkdir -p /tmp/combat-restore && tar xzf /tmp/combat-offsite_20260601_033000.tar.gz -C /tmp/combat-restore

# 4) 回写 db 和 overlay
cp /tmp/combat-restore/combat.db /opt/combat-v2/data/combat.sqlite
rsync -a --delete /tmp/combat-restore/data_schemas-overlay/ /opt/combat-v2/data/schemas-overlay/

# 5) 起服
systemctl start combat-v2
curl -sf http://localhost:3001/api/health
```

> 注意:`config/schemas/` 由 git 跟踪,通常应回写到 repo 检出而不是覆盖运行时,
> 否则下次 deploy 会用 HEAD 把它覆盖回来。Schema overlay (`data/schemas-overlay/`)
> 是 deploy 不动的运行时态,务必恢复。

## 验证清单

- [ ] cron job 可见 (`systemctl status cron` / `crontab -l`)
- [ ] 远端目录写权限 OK (`ssh combat@backup.example.com 'ls /backups/combat-v2'`)
- [ ] 备份文件大小符合预期 (含 db + schemas + overlay)
- [ ] 测试恢复演练:每季度至少一次,在测试机用最近的 tar.gz 重建并跑 e2e

## 故障排查

| 症状                                                                     | 排查                                                                         |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `nothing to back up: all source paths missing`                           | `--db` / `--schemas` / `--overlay` 路径全错;先用 `--dry-run` 打印 plan       |
| SSH 连接超时                                                             | 远端防火墙 / 安全组未放行 SFTP (22 或自定义端口);用 `ssh -p <port>` 单独验证 |
| `must set --key, $COMBAT_BACKUP_SSH_KEY, or $COMBAT_BACKUP_SSH_PASSWORD` | 鉴权信息没传到 CLI / API;后端走环境变量,详见 §2                              |
| 备份 tar 体积异常大                                                      | 检查 schemas-overlay/ 是否堆积了过期文件;脚本本身只 copy 不过滤              |

## 来源

- 评审条目: `docs/REVIEWS/REVIEW_performance.md` 弱项 ✗ 10 (无异地备份)
- 桶: harden v2.4
