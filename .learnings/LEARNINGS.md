# Learnings Log

## [LRN-20260525-001] best_practice

**Logged**: 2026-05-25T23:55:00+08:00
**Priority**: high
**Status**: promoted
**Area**: infra

### Summary
部署到目标机应通过跳板机 git clone + scp，而非 stdin 管道传输

### Details
部署架构为：开发机 → 跳板机(47.103.99.229) → 目标机(60.204.199.234)

**失败路径**：`deploy.mjs` 的 `stdinPut()` 通过 SSH exec 管道 (`cat > remote`) 传输 tar.gz 文件（~643KB）。在跳板机网络上，SSH exec stdin 管道传输二进制数据极不稳定，反复超时（10 分钟+）。

**成功路径**：在跳板机上从 GitHub 拉代码 → 打包 → scp 到目标机：
1. 跳板机: `git clone https://github.com/l17728/combat-platform.git /tmp/combat-deploy`
2. 跳板机: `cd /tmp/combat-deploy && git archive --format=tar.gz -o /tmp/combat-v2.tar.gz HEAD`
3. 跳板机: `scp /tmp/combat-v2.tar.gz root@60.204.199.234:/tmp/`
4. 目标机: `cd /opt/combat-v2 && tar xzf /tmp/combat-v2.tar.gz`
5. 目标机: `npm install && cd apps/frontend-v2 && npm run build`
6. 目标机: `systemctl restart combat-v2`

### Suggested Action
更新 `scripts/deploy-v2/deploy.mjs` 的 doDeploy 函数，将 stdinPut 上传方式替换为跳板机 git clone + archive + scp 方式。

### Metadata
- Source: error_recovery
- Related Files: scripts/deploy-v2/deploy.mjs
- Tags: deploy, ssh, scp, relay, timeout

**Promoted**: AGENTS.md (部署架构部分)

---
