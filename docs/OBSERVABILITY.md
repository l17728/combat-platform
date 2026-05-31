# 可观测性 (Observability)

> v2.4 起后端 + 前端均集成 Sentry。无 DSN 时完全 no-op,不影响开发与本机测试。

## Sentry 集成

### 后端 (apps/backend)

| 变量 | 必填 | 用途 |
|------|------|------|
| `SENTRY_DSN` | 否 | 设置后启用上报;未设 = no-op |
| `SENTRY_RELEASE` | 否 | 默认 `combat-backend` |
| `SENTRY_TRACES_RATE` | 否 | 性能采样率 (0..1),默认 `0` |
| `NODE_ENV` | 否 | environment 标签 |

抓取点(全部经 `apps/backend/src/sentry.ts::captureException`):
- `process.on('uncaughtException')` (server.ts 启动顶部)
- `process.on('unhandledRejection')` (同上)
- `asyncHandler` 中所有 Promise 拒绝(`logger.ts`)

### 前端 (apps/frontend-v2)

| 变量 | 必填 | 用途 |
|------|------|------|
| `VITE_SENTRY_DSN` | 否 | 设置后启用上报;未设 = no-op |
| `VITE_SENTRY_RELEASE` | 否 | 默认 `combat-frontend` |
| `VITE_SENTRY_TRACES_RATE` | 否 | 性能采样率 (0..1),默认 `0` |

抓取点(全部经 `apps/frontend-v2/src/sentry.ts::captureException`):
- `ErrorBoundary.componentDidCatch` (React 渲染异常)

> 全局 `window.error` / `unhandledrejection` 已由 `utils/op-logger.ts::setupGlobalErrorHandler()` 兜底,后续可改造同时上报 Sentry(目前仅写本地 op_log 表)。

## 部署配置

### systemd drop-in 注入(推荐)

```bash
ssh root@<host>
cat > /etc/systemd/system/combat-v2.service.d/sentry.conf <<EOF
[Service]
Environment="SENTRY_DSN=https://xxx@o0.ingest.sentry.io/0"
Environment="SENTRY_RELEASE=v2.4.0"
EOF
systemctl daemon-reload
systemctl restart combat-v2
```

### 前端构建时注入

```bash
# 构建前端时:
VITE_SENTRY_DSN=https://xxx@o0.ingest.sentry.io/0 \
VITE_SENTRY_RELEASE=v2.4.0 \
  npm run build --workspace=@combat/frontend-v2
```

> 前端 DSN 是公开值(走浏览器),不算敏感凭据;但仍建议放到部署环境而非源码。

## 验证

```bash
# 1. 后端故意触发一个 unhandled rejection
curl -s http://localhost:3001/api/__sentry_test  # 该 endpoint 不存在,触发 404 不算
# 真实测试:
node -e "import('@sentry/node').then(s => { s.init({ dsn: process.env.SENTRY_DSN }); s.captureMessage('combat-v2 sentry-test'); setTimeout(() => process.exit(0), 2000); })"

# 2. 前端浏览器 console:
window.dispatchEvent(new ErrorEvent('error', { error: new Error('frontend-sentry-test') }))
```

数分钟内 Sentry 项目应收到事件。

## 与现有日志体系的关系

| 层 | 现有 | Sentry 补充 |
|----|------|-------------|
| 结构化日志 | `backend.log` 文件 | 仍是主诊断面 |
| 审计日志 | SQLite `audit_log` | 不改变 |
| 操作日志 | SQLite `op_logs` | 不改变 |
| **错误聚合** | 无 | **Sentry 提供分组、去重、趋势** |

Sentry 不替代任何现有日志,只在"错误聚合 + 告警 + 跨进程归并"维度补一层。
