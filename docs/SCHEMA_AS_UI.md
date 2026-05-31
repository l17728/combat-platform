# Schema as UI (v2.6 → v2.7)

> Single-source-of-truth: a field's render, validate, group and order are all declared on its `FieldSchema`. Add a field in 表结构管理, the detail page (and its edit drawer) reflects it immediately — without a frontend code change.

## 1. Extended `FieldSchema`

`packages/shared/src/types.ts`:

| Property         | Type               | Meaning                                                                            |
| ---------------- | ------------------ | ---------------------------------------------------------------------------------- |
| `group`          | `string?`          | UI group name (基础信息 / 人员信息 / 详细信息 / 系统字段 / ...). Empty → 「其它」. |
| `order`          | `number?`          | Ascending order within the group. Ties resolved by schema array order.             |
| `visible`        | `string?`          | Visibility DSL expression — see §3. NEVER `eval`'d.                                |
| `defaultValue`   | `unknown?`         | Used as `initialValues` for new records (frontend Form).                           |
| `validation`     | `FieldValidation?` | `{ pattern, min, max, minLength, maxLength }` — translated to AntD Form rules.     |
| `specialControl` | `string?`          | Marker for fields that need bespoke UI (see §5).                                   |

Existing properties (`id`, `name`, `type`, `label`, `required`, `enumValues`, `refType`, `concept`, `anchor`, `aliases`, `optionsKey`, `retired`, `source`) keep their meanings.

### Supported `FieldType`s

`SchemaField.tsx` renders:

| Type           | View mode                                    | Edit mode                                             |
| -------------- | -------------------------------------------- | ----------------------------------------------------- |
| `string`       | plain text                                   | `<Input>`                                             |
| `textarea`     | preserved whitespace span                    | `<Input.TextArea rows=3>`                             |
| `number`       | plain text                                   | `<InputNumber>` (honors `validation.min/max`)         |
| `boolean`      | 是 / 否                                      | `<Switch>`                                            |
| `enum`         | `<Tag>`                                      | `<Select>` with `enumValues`                          |
| `date`         | `YYYY-MM-DD`                                 | `<DatePicker>`                                        |
| `datetime`     | `YYYY-MM-DD HH:mm` (via dayjs)               | `<DatePicker showTime>`                               |
| `ref` (person) | name span                                    | `<Select showSearch>` from `personOptions`            |
| `ref` (other)  | router `<Link>` to `/related/<refType>/<id>` | `<Input>` placeholder=`<refType> id`                  |
| `array`        | comma-split `<Tag>`s                         | `<Select mode="tags" tokenSeparators=[,]>`            |
| `json`         | pretty-printed `<pre>`                       | `<Input.TextArea rows=4>`                             |
| `sequence`     | plain text (system-managed)                  | not editable — falls through to `<Input>` if surfaced |

The renderer accepts `{field, value, onChange, mode='edit'}` (`SchemaFieldInput`) or `{field, value}` (`SchemaFieldView`). When used inside an `<AntD Form.Item>` the `value/onChange/id` are injected by AntD's cloneElement; `id` lands on the underlying control so `<label htmlFor>` linkage works and Playwright `getByLabel(...)` resolves.

## 2. Grouping & order

`groupAndSortFields(fields)` (exported from `SchemaField.tsx`):

1. Bucket fields by `group` (empty/missing → 「其它」).
2. Sort groups by the smallest `order` in the bucket (stable across reloads — newly-added groups stay where their first field's order says).
3. Within each bucket sort by `(order asc, original-index asc)`.

`AttackBasicInfoTab.tsx` renders one `<Card title={group}>` per bucket, with a `<Descriptions>` inside.

Edit drawer (`AttackDetailDrawers.tsx`) renders one `<Divider orientation="left">{group}</Divider>` per bucket, then `<Form.Item>` per field.

## 3. Visibility DSL (`visible`)

Tiny, **parser-only** (zero `eval`) language evaluated by `evalVisible(expr, record)`:

| Syntax                     | Example                | Meaning                            |
| -------------------------- | ---------------------- | ---------------------------------- |
| `<field> == <value>`       | `状态 == "已关闭"`     | Hide when status is anything else. |
| `<field> != <value>`       | `状态 != "已关闭"`     | Hide once the ticket is closed.    |
| `<field> in [v1, v2, ...]` | `事件级别 in [P1, P2]` | Show only for P1/P2.               |

Tokens may be bare words, double- or single-quoted strings; the parser strips quotes verbatim, so Chinese works without quotes. Unknown / malformed expressions default to `visible = true` (we never accidentally hide a field because someone fat-fingered the DSL).

## 4. Backend op: `updateField`

`PATCH /api/schema/<nodeType>`:

```jsonc
{
  "op": "updateField",
  "id": "标题",
  "group": "基础信息", // string — set;  null — clear; undefined — no change
  "order": 1, // number | null
  "visible": "状态 != 已关闭", // string | null
  "defaultValue": "默认标题", // any (use null to clear)
  "validation": { "minLength": 2, "maxLength": 100 }, // FieldValidation | null
}
```

Audit-logged as `SCHEMA_updateField`. Rolls back on write failure (existing `applyFieldOp` self-verifies the written JSON file).

`addField` also accepts `group` and `order` so a newly created field can land in the right place immediately:

```jsonc
{
  "op": "addField",
  "field": { "name": "客户邮箱", "type": "string", "label": "客户邮箱", "group": "联系方式", "order": 2 },
}
```

## 5. `specialControl` — opt-out of generic rendering

Some fields are too domain-specific for the generic renderer. They keep a marker so the detail page knows to skip them in the generic drawer (or to render a bespoke widget).

| `specialControl` | Field                          | Owner                                           |
| ---------------- | ------------------------------ | ----------------------------------------------- |
| `member-multi`   | 攻关成员                       | 编辑抽屉 fallback (multi-select) + 成员管理 Tab |
| `member-list`    | 成员列表                       | 成员管理 Tab                                    |
| `member-leader`  | 攻关组长                       | 编辑抽屉 (person ref) + 成员管理 Tab            |
| `private-flag`   | 私密                           | 「设置/取消私密」按钮                           |
| `private-grants` | 私密授权人 / 私密授权组        | 「设置私密」 Drawer                             |
| `system`         | 创建人 / 时长 / 攻关单号 / ... | read-only; 基础信息 Tab 展示,不进编辑抽屉       |

`AttackDetail.tsx` filters `editableFields` via `EXCLUDED_EDIT_SPECIAL` — anything tagged `system / private-flag / private-grants / member-list` is excluded from the generic edit drawer.

## 6. Migration guide — hardcoded → schema

For each hardcoded field on a detail page:

1. Identify the field in `config/schemas/<nodeType>.json`. Add `group` + `order`.
2. If it should not be editable from the generic drawer, set `specialControl` and add the value to `EXCLUDED_EDIT_SPECIAL`.
3. Remove the hardcoded `<Form.Item>` from the drawer / `<Descriptions.Item>` from the detail tab.
4. Run e2e — the generic renderer should pick the field up automatically. If a Playwright `getByLabel(...)` fails the SchemaFieldInput is probably missing `id` forwarding for the new type — add it (see §1).

The attackTicket migration (v2.6) is the reference example — all 36 fields are now annotated with `group`/`order`.

## 7. v2.7 全栈化迁移记录

v2.6 只把 `attackTicket` 详情页/编辑抽屉做成 schema 驱动；v2.7 把这套机制推到所有详情/抽屉页面。

### 7.1 受影响 nodeType 一览

| nodeType           | 来源                                          | 真实存储               | UI 入口                             | v2.7 改动                                                                              |
| ------------------ | --------------------------------------------- | ---------------------- | ----------------------------------- | -------------------------------------------------------------------------------------- |
| `person`           | `config/schemas/person.json` (real)           | `nodes` 表             | `PeopleList` 创建/编辑/详情抽屉     | 补 `group/order`；3 个抽屉全部用 `SchemaFormBody` / `SchemaViewBody`                   |
| `contribution`     | `config/schemas/contribution.json` (real)     | `nodes` 表             | `Contributions` 个人贡献 录入/编辑  | 补 `group/order`；2 个抽屉用 `SchemaFormBody`，`关联攻关单` 用 `renderField` 拿 Select |
| `teamContribution` | `config/schemas/teamContribution.json` (real) | `nodes` 表             | `Contributions` 团队贡献 录入/编辑  | 补 `group/order`；`组员` 标 `specialControl: member-multi` 自动渲染人员多选            |
| `helpRequest`      | `config/schemas/helpRequest.json` (virtual)   | `help_requests` 专用表 | `HelpCenter` 发起求助抽屉           | **新 schema**；`SchemaFormBody`；`targetName`联动`targetEmail`保留为`renderField`      |
| `bugReport`        | `config/schemas/bugReport.json` (virtual)     | `bug_reports` 专用表   | `BugReport` 创建/编辑抽屉           | **新 schema**；截图/Console 日志 specialControl 保留专用 UI                            |
| `proposal`         | `config/schemas/proposal.json` (virtual)      | `proposals` 专用表     | `ProposalsPage` 详情卡(view-only)   | **新 schema**；`SchemaViewBody`；`confidence` 百分比 + `status` Tag 用 `renderValue`   |
| `reminder`         | `config/schemas/reminder.json` (virtual)      | `reminders` 专用表     | `RemindersPage` 详情抽屉(view-only) | **新 schema**；`SchemaViewBody`；`status` Tag + `body` Paragraph 用 `renderValue`      |

### 7.2 Virtual schema (`virtual: true`)

`helpRequest` / `bugReport` / `proposal` / `reminder` 的数据存在专用表里（`help_requests` / `bug_reports` / `proposals` / `reminders`），不走 `nodes` 表。但它们的字段定义、分组、排序需要前端渲染参考——所以也写成 `config/schemas/<nodeType>.json`，但额外加 `"virtual": true`。

**后端路由 gate**（`routes.ts`）：

```ts
// GET /api/nodes/:nodeType
if (schema.virtual) {
  return res.status(400).json({ error: `虚拟 schema (${nodeType}) 不支持通用节点 CRUD; 请改用其专用接口` });
}
// POST /api/nodes/:nodeType  同上
```

虚拟 schema 仍能通过 `/api/schema/list` 和 `/api/schema/<nodeType>` 提供给前端拉取；`PATCH /api/schema/<nodeType>` 也能照常加字段/改 group。`/api/nodes/` 路径独占给真实 nodeType，避免双写到两套表。

### 7.3 `SchemaFormBody` / `SchemaViewBody`

`SchemaField.tsx` 在 v2.7 新增两个高阶组件，让调用方一行替代上百行手写 Form.Item：

```tsx
// 编辑抽屉
<Form form={form} layout="vertical" onFinish={handleCreate}>
  <SchemaFormBody
    fields={editableFields}            // = editableFieldsOf(schema)
    personOptions={personOpts}
    refOptions={{ attackTicket, person }}
    renderField={(f) => f.name === "关联攻关单" ? <Form.Item ...><Select .../></Form.Item> : null}
  />
</Form>

// 只读详情
<SchemaViewBody
  fields={viewFields}                  // = viewFieldsOf(schema)
  values={detail.properties}
  column={2}
  renderValue={(f, v) => f.name === "confidence" ? `${v * 100}%` : null}
/>
```

`renderField` / `renderValue` 返回 `null` → 落回默认渲染；返回 React 节点 → override。

### 7.4 `useNodeSchema` + `editableFieldsOf` / `viewFieldsOf`

`apps/frontend-v2/src/hooks/useSchema.ts`：

```ts
const { schema } = useNodeSchema("contribution"); // 单例缓存 + TTL + in-flight 去重
const editable = editableFieldsOf(schema); // 剔除 retired + EXCLUDED_EDIT_SPECIAL
const viewable = viewFieldsOf(schema); // 只剔除 retired
```

`EXCLUDED_EDIT_SPECIAL` 默认排除：`system / member-list / private-grants / private-flag / node-ref / screenshot / console-logs`。调用方可传 `excludedSpecial` / `excludedNames` 覆盖。

### 7.5 specialControl 速查表（v2.7 全部已知值）

| `specialControl` | 用途                                                                    | 默认在 editFields 中是否保留 |
| ---------------- | ----------------------------------------------------------------------- | ---------------------------- |
| `system`         | 系统字段（创建人/时长/状态/createdAt…）                                 | 排除                         |
| `member-leader`  | 组长 = person ref（攻关组长 / 团队组长）                                | 保留                         |
| `member-multi`   | 多选人员（攻关成员 / 团队组员）→ 渲染 personOptions 多选                | 保留                         |
| `member-list`    | 成员列表（JSON）由专用 Tab 维护                                         | 排除                         |
| `private-flag`   | 攻关单 私密=是/否，由"设置/取消私密"按钮管                              | 排除                         |
| `private-grants` | 私密授权人/组（JSON），由"设置私密"Drawer 管                            | 排除                         |
| `node-ref`       | proposal 的 sourceNodeId/targetNodeId — 视图侧用 renderValue 解析为名称 | 排除（仅 view 用）           |
| `screenshot`     | bugReport 截图 — 由粘贴/拖拽专用 UI 管                                  | 排除（专用上传）             |
| `console-logs`   | bugReport console 日志 — 由 console-capture 模块自动捕获                | 排除（专用 UI）              |

### 7.6 操作指南：给已迁移的 nodeType 加新字段

1. 进入「表结构管理」(`/schema`) → 选中要改的 schema（如 `person`、`bugReport`）
2. 「添加新字段」面板：填名称、类型、分组、顺序（可后续调整）
3. 立即生效：
   - 真实 nodeType（person/contribution/teamContribution）→ 列表页 + 创建/编辑抽屉 + 详情 全部出现新字段
   - 虚拟 nodeType（helpRequest/bugReport/proposal/reminder）→ 对应抽屉/详情面板出现新字段；后端的专用表也得相应允许该字段（v2.7 范围内 helpRequest/bugReport 的 properties 用 JSON 列存任意键，proposal/reminder 由系统写入,不接受用户字段）

> **限制**：虚拟 schema 加字段后能在 UI 里输入，但若专用表没有对应列存储，提交时后端会忽略 / 报错。这是 v2.7 的已知边界——若需要 helpRequest/bugReport 真正接收自定义字段，需要后续把它们的 storage 也改成 properties JSON 列。

## 8. SchemaWizard 字段分组管理

`SchemaWizard.tsx`:

- 字段详情卡顶部新增「字段分组」面板:列出当前 schema 所有分组 + count + 「新建分组」输入框。
- 字段表格新增「分组」列(行内 `<Select>` 切换字段所属分组)+ 「顺序」列(↑/↓ 按钮重排 + 当前 `order` 显示)。
- 「添加新字段」面板加「分组」选择,新字段直接落到指定分组。
- 所有改动通过 `api.patchSchema(nt, { op: "updateField", ... })` 写回后端,审计日志同步记录。
