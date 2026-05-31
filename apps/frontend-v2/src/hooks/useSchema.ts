import { useState, useEffect } from "react";
import type { NodeSchema, FieldSchema } from "@combat/shared";
import { api } from "../api.js";

// v2.7: Schema 缓存 hook —— 所有 schema-driven 详情/抽屉共用。
// 与 useSettings 同款单例 + TTL + in-flight 去重模式,避免 N 处页面各自 fetch /api/schema/list。

type SchemaList = NodeSchema[];

const TTL_MS = 5 * 60 * 1000;
let cache: SchemaList | null = null;
let cacheAt = 0;
let inflight: Promise<SchemaList> | null = null;
const subscribers = new Set<(s: SchemaList) => void>();

function fresh(): boolean {
  return cache !== null && Date.now() - cacheAt < TTL_MS;
}

function notify(next: SchemaList): void {
  for (const cb of subscribers) cb(next);
}

function fetchAll(): Promise<SchemaList> {
  if (inflight) return inflight;
  inflight = api
    .listSchemas()
    .then((all) => {
      cache = all;
      cacheAt = Date.now();
      inflight = null;
      notify(all);
      return all;
    })
    .catch((err) => {
      inflight = null;
      throw err;
    });
  return inflight;
}

/** Invalidate the cache (e.g. after schema patch). */
export function refreshSchemas(): Promise<SchemaList> {
  cache = null;
  cacheAt = 0;
  return fetchAll();
}

export function useSchemaList() {
  const [schemas, setSchemas] = useState<SchemaList>(() => cache ?? []);
  const [ready, setReady] = useState<boolean>(() => fresh());

  useEffect(() => {
    const onUpdate = (s: SchemaList) => {
      setSchemas(s);
      setReady(true);
    };
    subscribers.add(onUpdate);
    if (!fresh()) {
      fetchAll().catch(() => {
        /* error logged elsewhere */
      });
    } else {
      setReady(true);
    }
    return () => {
      subscribers.delete(onUpdate);
    };
  }, []);

  return { schemas, ready };
}

/** Pull a single nodeType's schema (or undefined if not registered). */
export function useNodeSchema(nodeType: string): { schema: NodeSchema | undefined; ready: boolean } {
  const { schemas, ready } = useSchemaList();
  const schema = schemas.find((s) => s.nodeType === nodeType);
  return { schema, ready };
}

// ---------------------------------------------------------------------------
// Helpers — field selection for drawer / detail
// ---------------------------------------------------------------------------

/** Default specialControl markers excluded from generic edit drawers. */
export const EXCLUDED_EDIT_SPECIAL = new Set([
  "system",
  "member-list",
  "private-grants",
  "private-flag",
  "node-ref",
  "screenshot",
  "console-logs",
]);

export interface FieldSelectionOpts {
  /** Override the default excluded set; pass [] to include everything. */
  excludedSpecial?: Iterable<string>;
  /** Also drop these specific field names. */
  excludedNames?: Iterable<string>;
}

/** Fields eligible for an "edit" drawer — skip retired + system-only markers. */
export function editableFieldsOf(schema: NodeSchema | undefined, opts: FieldSelectionOpts = {}): FieldSchema[] {
  if (!schema) return [];
  const excluded = new Set(opts.excludedSpecial ?? EXCLUDED_EDIT_SPECIAL);
  const dropNames = new Set(opts.excludedNames ?? []);
  return schema.fields.filter((f) => {
    if (f.retired) return false;
    if (dropNames.has(f.name)) return false;
    if (f.specialControl && excluded.has(f.specialControl)) return false;
    return true;
  });
}

/** Fields eligible for a "view" detail panel — keep system fields, drop retired only. */
export function viewFieldsOf(
  schema: NodeSchema | undefined,
  opts: { excludedNames?: Iterable<string> } = {}
): FieldSchema[] {
  if (!schema) return [];
  const dropNames = new Set(opts.excludedNames ?? []);
  return schema.fields.filter((f) => !f.retired && !dropNames.has(f.name));
}
