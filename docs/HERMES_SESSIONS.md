# Hermes 会话记忆 (v2.8)

Hermes 从 v2.8 起支持多轮对话上下文记忆，AI 可以记住之前的问答内容，实现连贯对话。

## 架构

```
前端 HermesChat                    后端
┌──────────────┐    POST /hermes/ask    ┌──────────────────┐
│ sessionId    │ ──────────────────────>│ loadRecentMessages│
│ (auto-create)│    {question,sessionId}│ ↓                 │
│              │                        │ answerWithTool... │
│              │ <────────────────────  │ ↓                 │
│              │    {answer,...}         │ appendMessage x2  │
└──────────────┘                        └──────────────────┘
```

## 数据库

两张表（自动建表，无需迁移），通过 `DbAdapter` 接口同时支持 SQLite 和 PostgreSQL：

- `hermes_sessions` — id, userId, title, createdAt, updatedAt
- `hermes_messages` — id, sessionId, role(user/assistant), content, citations, createdAt

DDL 按 `adapter.kind` 分方言：

- SQLite: `datetime('now')` 默认值
- PostgreSQL: `now()::text` 默认值

所有 CRUD 函数签名均为 `async (adapter: DbAdapter, ...) → Promise<T>`，完全异步。

## REST API

| 方法     | 路径                       | 说明                                    |
| -------- | -------------------------- | --------------------------------------- |
| `GET`    | `/api/hermes/sessions`     | 列出当前用户的会话（按 updatedAt DESC） |
| `POST`   | `/api/hermes/sessions`     | 创建新会话 `{title?}`                   |
| `GET`    | `/api/hermes/sessions/:id` | 获取会话详情 + 所有消息                 |
| `PATCH`  | `/api/hermes/sessions/:id` | 更新标题 `{title}`                      |
| `DELETE` | `/api/hermes/sessions/:id` | 删除会话及其消息                        |
| `POST`   | `/api/hermes/ask`          | 问答（新增 `sessionId` 可选参数）       |

## Ask 端点集成

`POST /api/hermes/ask` 新增可选字段 `sessionId`：

```json
{
  "question": "刚才那个攻关单现在怎么样了？",
  "sessionId": "abc-123-def"
}
```

当 `sessionId` 传入时：

1. 加载该会话最近 20 条消息作为 `priorMessages`
2. 注入到 `runToolCalling` 的 messages 数组（在 system prompt 之后、当前 user question 之前）
3. 问答完成后，自动保存 user message 和 assistant message
4. 如果问题长度 ≤40 字符，自动更新会话标题

## 前端集成

`HermesChat.tsx` 改动：

- 首次提问时自动调用 `api.hermesCreateSession()` 获取 `sessionId`
- 后续提问携带 `sessionId`
- 新增"新对话"按钮（`+` 图标），点击后重置 `sessionId` 和消息列表
- 关闭浮窗不丢失会话，重新打开继续

`api.ts` 新增方法：

- `hermesListSessions()`
- `hermesCreateSession(title?)`
- `hermesGetSession(id)`
- `hermesDeleteSession(id)`
- `hermesUpdateSessionTitle(id, title)`
- `hermesAsk(question, context?, sessionId?)` 扩展签名

## 上下文折叠

历史消息通过 `hermes-agent.ts` 的 `foldContext()` 自动管理：

- 总 token 限制 `CONTEXT_MAX_BYTES`（~120KB）
- 超限时将早期 tool result 折叠为 summary，保留最近 2 轮完整上下文
- 确保 token 不爆

## 过期清理

`pruneExpiredSessions(adapter)` 清理 7 天未更新的会话。可在定时任务中调用。

## 测试

```bash
npx vitest run test/hermes-sessions.e2e.test.ts  # 13 个用例
```

覆盖：CRUD（创建/查询/列表/删除/更新标题）、消息追加/加载/限制、过期清理、REST API 5 个端点。
