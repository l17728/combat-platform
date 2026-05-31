# Schema as UI (v2.6)

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

## 7. SchemaWizard 字段分组管理

`SchemaWizard.tsx`:

- 字段详情卡顶部新增「字段分组」面板:列出当前 schema 所有分组 + count + 「新建分组」输入框。
- 字段表格新增「分组」列(行内 `<Select>` 切换字段所属分组)+ 「顺序」列(↑/↓ 按钮重排 + 当前 `order` 显示)。
- 「添加新字段」面板加「分组」选择,新字段直接落到指定分组。
- 所有改动通过 `api.patchSchema(nt, { op: "updateField", ... })` 写回后端,审计日志同步记录。
