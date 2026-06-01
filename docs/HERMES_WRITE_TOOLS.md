# Hermes 写工具 (v2.3.6)

Hermes 从 v2.3.6 起支持通过 LLM agent 调用**写工具**来执行数据变更操作（创建节点、更新字段、追加进展），不再局限于只读问答。

## 概览

| 工具           | 功能                             | 触发示例                       |
| -------------- | -------------------------------- | ------------------------------ |
| `create_node`  | 创建新节点（人员/攻关单/贡献等） | "帮我新建一个攻关单"           |
| `update_node`  | 更新节点属性（merge 模式）       | "把这个攻关单的状态改为已解决" |
| `add_progress` | 给攻关单追加进展记录             | "追加一条进展：已完成初步排查" |

## 安全机制

1. **环境门控**：必须设置 `HERMES_ENABLE_WRITE=1` 才会启用写工具，未设置时调用写工具返回 `write_tools_disabled`
2. **角色门控**：仅 `admin` 或 `leader` 角色可调用写工具，`normal` 角色返回 `permission_denied`
3. **确认机制**：所有写工具要求参数中包含 `_confirm: 'yes'`，LLM 需先在回答中描述操作再调用
4. **私密单保护**：`update_node` 检查 `isPrivateTicket`，私密攻关单仅创建人/成员可操作
5. **审计日志**：每次写操作通过结构化日志记录（event: `hermes.tool.write`）

写工具通过 `Repository` 的标准 CRUD 方法操作，天然支持 SQLite 和 PostgreSQL 双库（Repository 底层走 `DbAdapter` 异步接口）。

## 环境变量

```bash
HERMES_ENABLE_WRITE=1    # 开启写工具（必须显式设置）
```

生产环境通过 systemd drop-in 注入：

```ini
# /etc/systemd/system/combat-v2.service.d/hermes-write.conf
[Service]
Environment=HERMES_ENABLE_WRITE=1
```

## TOOL_SCHEMAS 条件暴露

写工具在 `TOOL_SCHEMAS`（给 LLM 的工具列表）中仅在 `HERMES_ENABLE_WRITE=1` 时出现。未启用时 LLM 看不到这些工具，不会尝试调用。

## 错误码

| 错误                   | 含义                             |
| ---------------------- | -------------------------------- |
| `write_tools_disabled` | 环境变量未设置                   |
| `permission_denied`    | 角色不足                         |
| `confirm_required`     | 缺少 `_confirm:'yes'`            |
| `unknown_node_type`    | nodeType 未在 schema 注册        |
| `node_not_found`       | 节点 ID 不存在                   |
| `private_ticket`       | 私密单权限不足                   |
| `wrong_type`           | add_progress 仅支持 attackTicket |

## 测试

```bash
npx vitest run test/hermes-write-tools.e2e.test.ts  # 11 个用例
```

覆盖：创建成功/未知类型/角色拒绝/无确认/更新成功/不存在ID/角色拒绝/追加进展/类型错误/无确认/环境门控。
