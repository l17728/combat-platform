# /fighting Dev 环境快速入门

## 几条规则

1. **生产 db** 在 `/opt/combat-v2/data/combat.sqlite` — 绝不可写
2. **dev db** 在 `/fighting/data/dev-combat.sqlite` — 完全独立
3. **生产 backend** 占用 :3001 — dev 用 :3500
4. **测试 db** 由 vitest 自动 in-memory / tmpdir,与上述两者**完全无关**

## 五个一键脚本

```bash
cd /fighting
./dev.sh                  # 启 dev backend(空 db 或之前留下的副本):3500
./dev-with-snapshot.sh    # 从生产 db 拷一份副本,然后启 dev backend :3500
./dev-frontend.sh         # 启 vite dev :5174 → /api 代理到 :3500
./dev-test.sh             # 跑 vitest e2e(739/739,纯 in-memory db)
./dev-e2e.sh              # 跑 Playwright(自启 webServer)
```

## 详细操作

### 改代码 + 跑测试

```bash
cd /fighting
git checkout -b feature/my-change
vim apps/backend/src/xxx.ts
./dev-test.sh             # 跑 vitest
```

### 调试生产数据(只读副本)

```bash
cd /fighting
./dev-with-snapshot.sh    # 副本含生产数据,任意改不影响生产
# 浏览器 http://124.156.193.122:3500/api/health
# 起 frontend: ./dev-frontend.sh
# 浏览器 http://124.156.193.122:5174
```

### 跑 e2e

```bash
./dev-e2e.sh              # 全套
./dev-e2e.sh e2e/contributions.spec.ts  # 单文件
```

## 切回看生产实例

dev 跑得再花没事,生产的代码、配置、db 都在 `/opt/combat-v2/`,完全隔离。

```bash
systemctl status combat-v2    # 看生产状态
tail -f /opt/combat-v2/backend.log
```

## 部署(从本地推送,不在服务器跑)

**绝不在服务器 /fighting 上跑 deploy-direct.mjs**(会绕回自部署)。

部署仍走本地 `D:\fighting\scripts\deploy-v2\deploy-direct.mjs`:
1. 本地 `git archive HEAD` 打 tar
2. SFTP 上传到生产 `/opt/combat-v2/`
3. SSH 跑 `npm install + npm run build + systemctl restart`
4. 健康检查

## Git safe.directory

Linux 上 `cd /fighting && git <cmd>` 第一次可能报 dubious ownership,执行:

```bash
git config --global --add safe.directory /fighting
```

(已配过,新 agent 进入若仍报需重跑此命令。)
