# Errors Log

## [ERR-20260525-001] deploy_stdin_pipe_timeout

**Logged**: 2026-05-25T23:55:00+08:00
**Priority**: high
**Status**: resolved
**Area**: infra

### Summary
deploy.mjs stdinPut() 通过跳板机 SSH exec 管道传输 tar.gz 反复超时

### Error
```
[2/5] uploading via stdin pipe...
(timeout after 600000ms)
```

### Context
- 命令: `cd scripts/deploy-v2 && node deploy.mjs deploy`
- 文件大小: ~643KB (combat-v2.tar.gz)
- 跳板机: 47.103.99.229 (Alibaba Cloud)
- 目标机: 60.204.199.234
- SSH 短命令（如 check）正常，只有大数据传输超时
- 尝试 4 次，每次超时 10 分钟

### Root Cause
SSH exec stdin 管道 (`cat > remote_path`) 传输二进制数据时，经跳板机网络不稳定，TCP 窗口卡住。跳板机到目标机的 scp 也正常（小文件），问题仅在开发机到跳板机的 stdin pipe。

### Resolution
改用跳板机本地 git clone + git archive + scp 到目标机的方式，完全绕过开发机→跳板机的大文件传输瓶颈。

### Metadata
- Reproducible: yes (每次 deploy 都会复现)
- Related Files: scripts/deploy-v2/deploy.mjs (stdinPut function, line 36-47)
- See Also: LRN-20260525-001

---
