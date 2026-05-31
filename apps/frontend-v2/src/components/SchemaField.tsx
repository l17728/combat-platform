import { Input, InputNumber, Select, Switch, DatePicker, Tag, Typography, Form } from "antd";
import type { FieldSchema, FieldValidation } from "@combat/shared";
import dayjs from "dayjs";
import { Link } from "react-router-dom";
import { DATE_FORMAT } from "../constants.js";

const { Text } = Typography;

export interface PersonOption {
  value: string;
  label: string;
}

export interface SchemaFieldRendererProps {
  field: FieldSchema;
  value?: unknown;
  onChange?: (v: unknown) => void;
  mode: "view" | "edit";
  personOptions?: PersonOption[];
  /** Display-only override: rendered in view mode (e.g. ref → link). */
  refDisplay?: (value: string, refType: string) => React.ReactNode;
}

// -----------------------------------------------------------------------------
// v2.6: Schema-as-UI 渲染器。
//
// view 模式: 把 FieldSchema + value 渲染为只读 React 节点(枚举/ref/array/json 各自的格式)。
// edit 模式: 把 FieldSchema 渲染为对应 antd 受控组件,onChange 透传给上层 Form。
//
// 任何 specialControl 字段(member-multi / private-grants / system 等) 由调用方专门处理,
// 不在通用渲染器里:它们走专用 Tab/Drawer。
// -----------------------------------------------------------------------------
export function SchemaFieldView(props: {
  field: FieldSchema;
  value: unknown;
  refDisplay?: SchemaFieldRendererProps["refDisplay"];
}): React.ReactElement {
  const { field, value, refDisplay } = props;
  if (value === undefined || value === null || value === "") {
    return <Text type="secondary">--</Text>;
  }
  const t = field.type;
  if (t === "boolean") {
    return <span>{value === true || value === "true" || value === "是" ? "是" : "否"}</span>;
  }
  if (t === "enum") {
    return <Tag>{String(value)}</Tag>;
  }
  if (t === "date") {
    const d = dayjs(value as string);
    return <span>{d.isValid() ? d.format("YYYY-MM-DD") : String(value)}</span>;
  }
  if (t === "datetime") {
    const d = dayjs(value as string);
    return <span>{d.isValid() ? d.format(DATE_FORMAT) : String(value)}</span>;
  }
  if (t === "ref" && field.refType) {
    const s = String(value);
    if (refDisplay) return <>{refDisplay(s, field.refType)}</>;
    if (field.refType === "person") return <span>{s}</span>;
    return <Link to={`/related/${field.refType}/${encodeURIComponent(s)}`}>{s}</Link>;
  }
  if (t === "array") {
    const arr = Array.isArray(value)
      ? value
      : String(value)
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
    return (
      <span>
        {arr.map((x, i) => (
          <Tag key={i}>{String(x)}</Tag>
        ))}
      </span>
    );
  }
  if (t === "json") {
    try {
      const obj = typeof value === "string" ? JSON.parse(value) : value;
      return <pre style={{ margin: 0, fontSize: 12 }}>{JSON.stringify(obj, null, 2)}</pre>;
    } catch {
      return <span>{String(value)}</span>;
    }
  }
  if (t === "textarea") {
    return <span style={{ whiteSpace: "pre-wrap" }}>{String(value)}</span>;
  }
  return <span>{String(value)}</span>;
}

export function SchemaFieldInput(props: {
  field: FieldSchema;
  value?: unknown;
  onChange?: (v: unknown) => void;
  personOptions?: PersonOption[];
}): React.ReactElement {
  const { field: f, value, onChange, personOptions } = props;
  const t = f.type;
  if (t === "enum") {
    return (
      <Select
        value={value as string | undefined}
        onChange={onChange}
        allowClear
        options={(f.enumValues ?? []).map((v) => ({ value: v, label: v }))}
        placeholder={f.label}
      />
    );
  }
  if (t === "boolean") {
    return <Switch checked={!!value} onChange={onChange} />;
  }
  if (t === "number") {
    return (
      <InputNumber
        value={value as number | undefined}
        onChange={onChange}
        style={{ width: "100%" }}
        min={f.validation?.min}
        max={f.validation?.max}
        placeholder={f.label}
      />
    );
  }
  if (t === "date") {
    const d = value ? dayjs(value as string) : null;
    return (
      <DatePicker
        value={d && d.isValid() ? d : null}
        onChange={(v) => onChange?.(v ? v.format("YYYY-MM-DD") : null)}
        style={{ width: "100%" }}
      />
    );
  }
  if (t === "datetime") {
    const d = value ? dayjs(value as string) : null;
    return (
      <DatePicker
        showTime
        value={d && d.isValid() ? d : null}
        onChange={(v) => onChange?.(v ? v.format("YYYY-MM-DDTHH:mm:ss") : null)}
        style={{ width: "100%" }}
      />
    );
  }
  if (t === "ref" && f.refType === "person") {
    return (
      <Select
        value={value as string | undefined}
        onChange={onChange}
        showSearch
        allowClear
        placeholder="搜索人员"
        options={personOptions ?? []}
        filterOption={(input, option) => (option?.label as string)?.toLowerCase().includes(input.toLowerCase())}
      />
    );
  }
  if (t === "ref") {
    return (
      <Input
        value={value as string | undefined}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={`${f.refType} id`}
      />
    );
  }
  if (t === "textarea") {
    return (
      <Input.TextArea
        value={value as string | undefined}
        onChange={(e) => onChange?.(e.target.value)}
        rows={3}
        placeholder={f.label}
        maxLength={f.validation?.maxLength}
      />
    );
  }
  if (t === "array") {
    return (
      <Select
        mode="tags"
        value={Array.isArray(value) ? (value as string[]) : []}
        onChange={onChange}
        tokenSeparators={[","]}
        placeholder={`${f.label}(回车/逗号分隔)`}
      />
    );
  }
  if (t === "json") {
    return (
      <Input.TextArea
        value={typeof value === "string" ? value : value ? JSON.stringify(value, null, 2) : ""}
        onChange={(e) => onChange?.(e.target.value)}
        rows={4}
        placeholder="JSON"
      />
    );
  }
  return (
    <Input
      value={value as string | undefined}
      onChange={(e) => onChange?.(e.target.value)}
      placeholder={f.label}
      maxLength={f.validation?.maxLength}
    />
  );
}

/**
 * Convert a FieldValidation into AntD Form rules. `required` is supplied via
 * the FieldSchema.required flag at the call site so we keep the messages here.
 */
export function buildFormRules(field: FieldSchema): unknown[] {
  const rules: unknown[] = [];
  if (field.required) rules.push({ required: true, message: `${field.label}不能为空` });
  const v: FieldValidation | undefined = field.validation;
  if (v?.pattern) {
    try {
      const re = new RegExp(v.pattern);
      rules.push({ pattern: re, message: `${field.label}格式不正确` });
    } catch {
      /* invalid pattern silently ignored — surface in schema editor */
    }
  }
  if (v?.minLength !== undefined) rules.push({ min: v.minLength, message: `至少 ${v.minLength} 个字符` });
  if (v?.maxLength !== undefined) rules.push({ max: v.maxLength, message: `最多 ${v.maxLength} 个字符` });
  if (v?.min !== undefined) rules.push({ type: "number", min: v.min, message: `最小值 ${v.min}` });
  if (v?.max !== undefined) rules.push({ type: "number", max: v.max, message: `最大值 ${v.max}` });
  return rules;
}

/**
 * Tiny eq/ne/in DSL evaluator for FieldSchema.visible.
 * Supports:
 *   - `<field> == <value>`
 *   - `<field> != <value>`
 *   - `<field> in [<v1>, <v2>, ...]`
 * Value tokens may be bare words, double-quoted strings, or simple unquoted CJK.
 * NEVER `eval`'d — pure parsing.
 */
export function evalVisible(expr: string | undefined, record: Record<string, unknown>): boolean {
  if (!expr) return true;
  const s = expr.trim();
  if (!s) return true;
  // <field> in [a, b, c]
  const inMatch = s.match(/^(\S+?)\s+in\s+\[(.+)\]\s*$/);
  if (inMatch) {
    const [, field, list] = inMatch;
    const target = String(record[field.trim()] ?? "");
    const items = list.split(",").map((x) => stripQuotes(x.trim()));
    return items.includes(target);
  }
  // <field> != <value>  /  <field> == <value>  /  <field> = <value>
  const eqMatch = s.match(/^(\S+?)\s*(!=|==|=)\s*(.+?)\s*$/);
  if (eqMatch) {
    const [, field, op, raw] = eqMatch;
    const left = String(record[field.trim()] ?? "");
    const right = stripQuotes(raw);
    return op === "!=" ? left !== right : left === right;
  }
  // Unknown expression → default visible (don't accidentally hide fields)
  return true;
}

function stripQuotes(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

/** Group fields by `group` (default 「其它」), sort each group by `order` then by index. */
export function groupAndSortFields(fields: FieldSchema[]): { group: string; fields: FieldSchema[] }[] {
  const buckets = new Map<string, { field: FieldSchema; idx: number }[]>();
  fields.forEach((f, idx) => {
    const g = (f.group && f.group.trim()) || "其它";
    if (!buckets.has(g)) buckets.set(g, []);
    buckets.get(g)!.push({ field: f, idx });
  });
  // Sort groups by the smallest order within them (stable across reloads).
  const groupOrder = Array.from(buckets.entries()).map(([group, arr]) => {
    const minOrder = Math.min(
      ...arr.map((x) => (x.field.order !== undefined ? x.field.order : Number.MAX_SAFE_INTEGER))
    );
    return { group, minOrder, arr };
  });
  groupOrder.sort((a, b) => a.minOrder - b.minOrder);
  return groupOrder.map(({ group, arr }) => {
    arr.sort((a, b) => {
      const oa = a.field.order ?? Number.MAX_SAFE_INTEGER;
      const ob = b.field.order ?? Number.MAX_SAFE_INTEGER;
      if (oa !== ob) return oa - ob;
      return a.idx - b.idx;
    });
    return { group, fields: arr.map((x) => x.field) };
  });
}

/**
 * Form.Item wrapper for a single FieldSchema — handles label/rules.
 * Useful in drawers that want a one-liner per field.
 */
export function SchemaFormItem(props: { field: FieldSchema; personOptions?: PersonOption[] }): React.ReactElement {
  const { field, personOptions } = props;
  return (
    <Form.Item
      name={field.name}
      label={field.label}
      // antd accepts arbitrary rule descriptors; cast to any to bridge the unknown[] from buildFormRules
      rules={buildFormRules(field) as any}
    >
      <SchemaFieldInput field={field} personOptions={personOptions} />
    </Form.Item>
  );
}

export default SchemaFieldView;
